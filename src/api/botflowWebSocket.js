import { DYNAMICADK_BASE_URL } from '../config/api';

// Fallback baseline offset when an event lacks a server timestamp.
// Dedupe by id on catch-up merge absorbs the resulting small overlap.
const SAFETY_MARGIN_MS = 60_000;

/**
 * BotFlow WebSocket manager for real-time bot/flow state sync.
 *
 * Admin panel connects without tenant_id → joins botflow_admin group → sees ALL tenants.
 * Emits events: bot.created, bot.updated, bot.status_changed, bot.deleted,
 *               flow.created, flow.updated, flow.published, flow.deleted,
 *               stats.updated, execution.completed, credits.deducted,
 *               connected, disconnected, reconnected
 */
export class BotFlowWebSocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this._reconnectTimer = null;
    this._tenantId = null;
    this._wasConnected = false;
    this._disposed = false;
    this._heartbeatInterval = null;
    this._pongTimeout = null;
    this._clientCount = 0;
    // Track B: last server-attested message time, used as since_ts baseline
    // on reconnect catch-up. Persists across auto-reconnects; cleared only
    // on terminal disconnect (last client releases).
    this._lastMessageTime = null;
  }

  connect(tenantId) {
    this._clientCount++;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._disposed = false; // Allow reconnection (reset from previous disconnect)
    this.reconnectAttempts = 0;
    this._tenantId = tenantId;
    const wsBaseUrl = DYNAMICADK_BASE_URL.replace(/^http/, 'ws');
    const params = tenantId ? `?tenant_id=${tenantId}` : '';
    const url = `${wsBaseUrl}/ws/botflow/${params}`;

    console.log('[BotFlowWS] Connecting to', url);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      const wasReconnect = this._wasConnected;
      this._wasConnected = true;
      this.reconnectAttempts = 0;
      console.log('[BotFlowWS] Connected');
      this._emit('connected');
      if (wasReconnect) {
        console.log('[BotFlowWS] Reconnected — will re-fetch data');
        this._emit('reconnected');
      }
      this._startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          // Heartbeat response — clear pong timeout
          this._clearPongTimeout();
          return;
        }
        if (data.event) {
          // Track B: capture the server-attested timestamp BEFORE emitting so
          // catch-up baselines never leak client-clock skew. If the envelope
          // lacks a timestamp (defensive), back off by SAFETY_MARGIN_MS so the
          // next since_ts is conservatively in the past.
          this._lastMessageTime = data.timestamp
            || new Date(Date.now() - SAFETY_MARGIN_MS).toISOString();
          console.log('[BotFlowWS] Event:', data.event, data.payload);
          this._emit(data.event, data.payload, data.tenant_id);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = (event) => {
      console.log('[BotFlowWS] Disconnected, code:', event.code, 'reason:', event.reason);
      this._stopHeartbeat();
      this._emit('disconnected');
      if (this._disposed) return; // Intentional disconnect, don't reconnect
      if (event.code !== 4001 && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        console.log(`[BotFlowWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this._reconnectTimer = setTimeout(() => {
          if (!this._disposed) this._reconnect();
        }, delay);
      }
    };

    this.ws.onerror = (event) => {
      console.error('[BotFlowWS] WebSocket error:', event);
    };
  }

  // Internal reconnect — same as connect() but doesn't bump _clientCount
  _reconnect() {
    const saved = this._clientCount;
    this.connect(this._tenantId);
    this._clientCount = saved;
  }

  disconnect() {
    this._clientCount = Math.max(0, this._clientCount - 1);
    if (this._clientCount > 0) return; // Other pages still need the connection

    this._disposed = true; // Prevent any pending reconnect timers from firing
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._stopHeartbeat();
    this.reconnectAttempts = this.maxReconnectAttempts;
    this._wasConnected = false;
    this._lastMessageTime = null; // Track B: terminal disconnect resets baseline
    this.listeners = {}; // Clear listeners — last client is gone
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Track B: current catch-up baseline. `null` means "no prior message";
  // callers skip since_ts catch-up and fall back to blind full refetch.
  getLastMessageTime() {
    return this._lastMessageTime;
  }

  // Track B: accept a server-attested timestamp unconditionally (e.g., from
  // a catch-up response's `server_ts`) so clock-skew correction works even
  // when the client's local baseline is ahead of server time.
  setLastMessageTime(iso) {
    if (typeof iso === 'string' && iso) {
      this._lastMessageTime = iso;
    }
  }

  // --- Heartbeat: detect silent failures (Redis down, network drop) ---

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          return;
        }
        // Expect pong within 10s, otherwise force-close
        this._pongTimeout = setTimeout(() => {
          console.warn('[BotFlowWS] No pong received, closing connection');
          if (this.ws) this.ws.close();
        }, 10000);
      }
    }, 30000); // Ping every 30s
  }

  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    this._clearPongTimeout();
  }

  _clearPongTimeout() {
    if (this._pongTimeout) {
      clearTimeout(this._pongTimeout);
      this._pongTimeout = null;
    }
  }

  // --- Event emitter ---

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data, tenantId) {
    (this.listeners[event] || []).forEach(cb => {
      try { cb(data, tenantId); } catch {}
    });
  }
}

// Singleton instance
export const botflowWs = new BotFlowWebSocket();
