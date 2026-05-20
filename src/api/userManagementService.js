import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';

const base = `${DYNAMICADK_BASE_URL}/api/admin-panel`;

const _fetch = async (url) => {
  const res = await authenticatedFetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
};

export const userManagementService = {
  /**
   * Track A2: fetch all bots via the unified analytics endpoint.
   * The response carries A1 aliases (`flows` envelope key, per-row `flowId`,
   * `botStatus`, `totalTokens`, `creditsUsed`, `lastActive`), so the
   * UserManagement.jsx consumer code is unchanged.
   */
  getBots: ({ search = '', pageSize = 200 } = {}) => {
    const p = new URLSearchParams({ page: '1', page_size: String(pageSize) });
    if (search) p.set('search', search);
    return _fetch(`${base}/bot-analytics/bots/?${p.toString()}`);
  },

  /**
   * Track A2: fetch per-tenant aggregated client data via the unified
   * endpoint. A1 ships this as a byte-equivalent mirror of the legacy
   * /user-management/clients/ response via a shared helper.
   */
  getClients: () => {
    return _fetch(`${base}/bot-analytics/clients/`);
  },
};

export default userManagementService;
