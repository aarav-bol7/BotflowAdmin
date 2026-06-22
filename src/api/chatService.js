import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';

const base = `${DYNAMICADK_BASE_URL}/api/admin-panel/chats`;

const _fetch = async (url) => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
};

export const chatService = {
  /**
   * @deprecated Track E — for plain tenant enumeration use
   * enumerationService.getTenants(). Retained for call sites that need
   * legacy per-tenant aggregates (sessionCount, token totals, grand totals).
   */
  getTenants: ({ startDate, endDate } = {}) => {
    const p = new URLSearchParams();
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    const qs = p.toString();
    return _fetch(`${base}/tenants/${qs ? '?' + qs : ''}`);
  },

  /**
   * @deprecated Track E — use enumerationService.getBotsByTenant(tenantId, {startDate, endDate}).
   * Legacy endpoint retained.
   */
  getBots: (tenantId, { startDate, endDate } = {}) => {
    const p = new URLSearchParams({ tenant_id: tenantId });
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    return _fetch(`${base}/bots/?${p.toString()}`);
  },

  getSessions: (tenantId, botKey, { channel = '', search = '', page = 1, pageSize = 20, startDate, endDate } = {}) => {
    const p = new URLSearchParams({
      tenant_id: tenantId,
      bot_key: botKey,
      page: String(page),
      page_size: String(pageSize),
    });
    if (channel) p.set('channel', channel);
    if (search) p.set('search', search);
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    return _fetch(`${base}/sessions/?${p.toString()}`);
  },

  getSessionMessages: (sessionId, type = 'text', { startDate, endDate } = {}) => {
    const p = new URLSearchParams({ type });
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    // sessionId is the ADK session id ("{botKey}:{userId}") — contains ':' and '+', must be encoded.
    return _fetch(`${base}/sessions/${encodeURIComponent(sessionId)}/messages/?${p.toString()}`);
  },

  // Track B catch-up — sessions with since_ts. Envelope: { items, truncated, server_ts }.
  getSessionsCatchup: async (tenantId, botKey, filters = {}, signal) => {
    const p = new URLSearchParams({ tenant_id: tenantId, bot_key: botKey });
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    });
    const res = await authenticatedFetch(`${base}/sessions/?${p.toString()}`, { signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },

  // Track B catch-up — session messages with since_ts. Envelope: { items, truncated, server_ts }.
  getSessionMessagesCatchup: async (sessionId, type = 'text', sinceTs, signal) => {
    const p = new URLSearchParams({ type });
    if (sinceTs) p.set('since_ts', sinceTs);
    const res = await authenticatedFetch(`${base}/sessions/${encodeURIComponent(sessionId)}/messages/?${p.toString()}`, { signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
};

export default chatService;
