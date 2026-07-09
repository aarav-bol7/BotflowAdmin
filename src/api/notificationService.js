import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';

const BASE = `${DYNAMICADK_BASE_URL}/api/notifications`;

// Fallback baseline offset when a notification payload lacks created_at.
// Dedupe by id on catch-up absorbs the resulting small overlap.
const SAFETY_MARGIN_MS = 60_000;

export const notificationService = {
  /**
   * Fetch paginated notifications.
   * @param {object} filters - { tenant_id, bot_key, category, severity, is_read, page, page_size }
   */
  fetchNotifications: async (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const response = await authenticatedFetch(`${BASE}/?${params.toString()}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch notifications (${response.status})`);
    }
    return response.json();
  },

  /**
   * Get unread notification count.
   * @param {object} filters - { tenant_id, bot_key }
   */
  getUnreadCount: async (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const response = await authenticatedFetch(`${BASE}/unread-count/?${params.toString()}`);
    if (!response.ok) return { count: 0 };
    return response.json();
  },

  /**
   * Mark specific notifications as read.
   * @param {string[]} ids
   */
  markRead: async (ids) => {
    const response = await authenticatedFetch(`${BASE}/mark-read/`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to mark notifications as read');
    }
    return response.json();
  },

  /**
   * Mark all notifications as read.
   * @param {object} filters - { tenant_id, bot_key }
   */
  markAllRead: async (filters = {}) => {
    const response = await authenticatedFetch(`${BASE}/mark-all-read/`, {
      method: 'POST',
      body: JSON.stringify(filters),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to mark all as read');
    }
    return response.json();
  },

  /**
   * Create a new notification.
   * @param {object} data - { tenant_id, category, title, message, severity?, bot_key?, metadata? }
   */
  createNotification: async (data) => {
    const response = await authenticatedFetch(`${BASE}/create/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to create notification (${response.status})`);
    }
    return response.json();
  },

  /**
   * Delete (dismiss) one notification. Because dedup merges repeats into the
   * existing row, deleting a solved alert means a RECURRENCE creates a fresh
   * unread row — so a new outbreak is visible instead of silently merging
   * into an already-seen notification.
   * @param {string} id - notification UUID
   */
  deleteNotification: async (id) => {
    const response = await authenticatedFetch(`${BASE}/${id}/`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to delete notification (${response.status})`);
    }
    return response.json();
  },

  /**
   * Track B catch-up: fetch notifications created on/after `since_ts`.
   * Response shape: { items, truncated, server_ts }.
   * @param {object} filters - includes since_ts (required) + usual filters.
   * @param {AbortSignal} [signal] - abort the fetch (e.g., on view switch).
   */
  fetchNotificationsCatchup: async (filters = {}, signal) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });
    const response = await authenticatedFetch(`${BASE}/?${params.toString()}`, { signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const err = new Error(body.error || `Failed to fetch notifications catchup (${response.status})`);
      err.status = response.status;
      throw err;
    }
    return response.json();
  },
};

/**
 * Notification WebSocket manager for real-time updates.
 */
export class NotificationWebSocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this._reconnectTimer = null;
    // Track B: distinguish initial open from re-open so subscribers can
    // trigger catch-up only on reconnect (not on fresh connect).
    this._wasConnected = false;
    // Last server-attested notification time; used as since_ts baseline.
    this._lastMessageTime = null;
  }

  connect(tenantId) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._tenantId = tenantId;
    const wsBaseUrl = DYNAMICADK_BASE_URL.replace(/^http/, 'ws');
    // Admin panel: pass tenant_id if available, otherwise connect without filter
    const params = tenantId ? `?tenant_id=${tenantId}` : '';
    const url = `${wsBaseUrl}/ws/notifications/${params}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      const wasReconnect = this._wasConnected;
      this._wasConnected = true;
      this.reconnectAttempts = 0;
      this._emit('connected');
      if (wasReconnect) {
        this._emit('reconnected');
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_notification' || data.type === 'notification_updated') {
          // Track B: baseline from server-attested created_at. Fallback to
          // Date.now() minus SAFETY_MARGIN so we over-fetch on next catch-up
          // rather than miss rows; dedupe by id catches overlap.
          const n = data.notification;
          this._lastMessageTime = (n && n.created_at)
            || new Date(Date.now() - SAFETY_MARGIN_MS).toISOString();
          this._emit(data.type, n);
        } else if (data.type === 'pong') {
          // heartbeat response (no-op — no heartbeat emitter wired yet)
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = (event) => {
      this._emit('disconnected');
      if (event.code !== 4001 && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        this._reconnectTimer = setTimeout(() => this.connect(this._tenantId), delay);
      }
    };

    this.ws.onerror = (event) => {
      console.error('[NotificationWS] WebSocket error:', event);
    };
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnection
    this._wasConnected = false; // Track B: next connect is "fresh"
    this._lastMessageTime = null; // Track B: terminal disconnect resets baseline
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Track B: current catch-up baseline. `null` → callers skip catch-up.
  getLastMessageTime() {
    return this._lastMessageTime;
  }

  // Track B: accept server_ts unconditionally (skew correction).
  setLastMessageTime(iso) {
    if (typeof iso === 'string' && iso) {
      this._lastMessageTime = iso;
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data) {
    (this.listeners[event] || []).forEach(cb => {
      try { cb(data); } catch {}
    });
  }
}

// Singleton instance
export const notificationWs = new NotificationWebSocket();

export default notificationService;
