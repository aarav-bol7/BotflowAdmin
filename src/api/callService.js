import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';

const base = `${DYNAMICADK_BASE_URL}/api/admin-panel/calls`;

const _fetch = async (url) => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
};

export const callService = {
  getCalls: ({ search = '', status = '', page = 1, pageSize = 20 } = {}) => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) p.set('search', search);
    if (status) p.set('status', status);
    return _fetch(`${base}/?${p.toString()}`);
  },

  getCallDetail: (callPk) => _fetch(`${base}/${callPk}/`),

  getCallsGrouped: ({ tenantId, botKey, startDate, endDate, search = '', status = '', page = 1, pageSize = 20 } = {}) => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (tenantId) p.set('tenant_id', tenantId);
    if (botKey) p.set('bot_key', botKey);
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    if (search) p.set('search', search);
    if (status) p.set('status', status);
    return _fetch(`${base}/grouped/?${p.toString()}`);
  },

  /**
   * @deprecated Track E — use enumerationService.getTenants() when legacy
   * per-tenant aggregates are not needed. Retained for CallDetails's tenant
   * list which renders sessionCount/botCount per tenant.
   */
  getTenants: ({ startDate, endDate } = {}) => {
    const p = new URLSearchParams();
    if (startDate) p.set('start_date', startDate);
    if (endDate) p.set('end_date', endDate);
    const qs = p.toString();
    return _fetch(`${DYNAMICADK_BASE_URL}/api/admin-panel/chats/tenants/${qs ? '?' + qs : ''}`);
  },

  /**
   * @deprecated Track E — use enumerationService.getBotsByTenant(tenantId).
   * Legacy endpoint retained.
   */
  getBots: (tenantId) => _fetch(`${DYNAMICADK_BASE_URL}/api/admin-panel/chats/bots/?tenant_id=${encodeURIComponent(tenantId)}`),

  blockCaller: async (caller, botKey, durationHours = 24, reason = '') => {
    const res = await authenticatedFetch(`${base}/block-caller/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller, bot_key: botKey, duration_hours: durationHours, reason }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.error || `Request failed (${res.status})`);
    }
    return res.json();
  },

  unblockCaller: async (caller, botKey) => {
    const res = await authenticatedFetch(`${base}/unblock-caller/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller, bot_key: botKey }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.error || `Request failed (${res.status})`);
    }
    return res.json();
  },

  // Track B catch-up — flat calls list with since_ts. Response envelope is
  // { items, truncated, server_ts }. Caller (CallDetails, grouped view) uses
  // non-empty items as a signal to trigger a blind regroup refetch.
  fetchCallsCatchup: async (filters = {}, signal) => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    });
    const res = await authenticatedFetch(`${base}/?${p.toString()}`, { signal });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      const err = new Error(b.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
};

export default callService;
