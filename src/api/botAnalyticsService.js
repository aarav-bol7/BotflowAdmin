import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';

const BASE = `${DYNAMICADK_BASE_URL}/api/admin-panel/bot-analytics`;

/**
 * Helper: set a param only if non-empty and not 'all'.
 */
const _setFilter = (params, key, value) => {
  if (value && value !== 'all') params.set(key, value);
};

export const botAnalyticsService = {
  /**
   * Summary: aggregated stats scoped to the same filters as the bot list.
   */
  getSummary: async ({
    startDate, endDate,
    search = '', activity = '', activityMode = '', activitySince = '', activityUntil = '',
    status = '', errors = '', channel = '',
    tenantId = '', botType = '', tokenMin = '', tokenMax = '',
    errorSeverity = '', msgVolume = '', msgMin = '', msgMax = '',
  } = {}) => {
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    _setFilter(params, 'search', search);
    _setFilter(params, 'activity', activity);
    _setFilter(params, 'activity_mode', activityMode);
    if (activitySince) params.set('activity_since', activitySince);
    if (activityUntil) params.set('activity_until', activityUntil);
    _setFilter(params, 'status', status);
    _setFilter(params, 'errors', errors);
    _setFilter(params, 'channel', channel);
    _setFilter(params, 'tenant_id', tenantId);
    _setFilter(params, 'bot_type', botType);
    if (tokenMin) params.set('token_min', tokenMin);
    if (tokenMax) params.set('token_max', tokenMax);
    _setFilter(params, 'error_severity', errorSeverity);
    _setFilter(params, 'msg_volume', msgVolume);
    if (msgMin) params.set('msg_min', msgMin);
    if (msgMax) params.set('msg_max', msgMax);
    const qs = params.toString();
    const response = await authenticatedFetch(`${BASE}/summary/${qs ? '?' + qs : ''}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch summary (${response.status})`);
    }
    return response.json();
  },

  /**
   * Paginated, filterable, sortable bot list.
   */
  getBots: async ({
    search = '', page = 1, pageSize = 20, ordering = '',
    activity = '', activityMode = '', activitySince = '', activityUntil = '',
    status = '', errors = '', channel = '',
    tenantId = '', botType = '', tokenMin = '', tokenMax = '',
    errorSeverity = '', msgVolume = '', msgMin = '', msgMax = '',
    startDate, endDate,
  } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (ordering) params.set('ordering', ordering);
    _setFilter(params, 'search', search);
    _setFilter(params, 'activity', activity);
    _setFilter(params, 'activity_mode', activityMode);
    if (activitySince) params.set('activity_since', activitySince);
    if (activityUntil) params.set('activity_until', activityUntil);
    _setFilter(params, 'status', status);
    _setFilter(params, 'errors', errors);
    _setFilter(params, 'channel', channel);
    _setFilter(params, 'tenant_id', tenantId);
    _setFilter(params, 'bot_type', botType);
    if (tokenMin) params.set('token_min', tokenMin);
    if (tokenMax) params.set('token_max', tokenMax);
    _setFilter(params, 'error_severity', errorSeverity);
    _setFilter(params, 'msg_volume', msgVolume);
    if (msgMin) params.set('msg_min', msgMin);
    if (msgMax) params.set('msg_max', msgMax);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);

    const response = await authenticatedFetch(`${BASE}/bots/?${params.toString()}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch bots (${response.status})`);
    }
    return response.json();
  },

  /**
   * Per-channel breakdown scoped to current filters.
   */
  getChannelBreakdown: async ({
    search = '', activity = '', activityMode = '', activitySince = '', activityUntil = '',
    status = '', errors = '', channel = '',
    tenantId = '', botType = '', tokenMin = '', tokenMax = '',
    errorSeverity = '', msgVolume = '', msgMin = '', msgMax = '',
  } = {}) => {
    const params = new URLSearchParams();
    _setFilter(params, 'search', search);
    _setFilter(params, 'activity', activity);
    _setFilter(params, 'activity_mode', activityMode);
    if (activitySince) params.set('activity_since', activitySince);
    if (activityUntil) params.set('activity_until', activityUntil);
    _setFilter(params, 'status', status);
    _setFilter(params, 'errors', errors);
    _setFilter(params, 'channel', channel);
    _setFilter(params, 'tenant_id', tenantId);
    _setFilter(params, 'bot_type', botType);
    if (tokenMin) params.set('token_min', tokenMin);
    if (tokenMax) params.set('token_max', tokenMax);
    _setFilter(params, 'error_severity', errorSeverity);
    _setFilter(params, 'msg_volume', msgVolume);
    if (msgMin) params.set('msg_min', msgMin);
    if (msgMax) params.set('msg_max', msgMax);
    const qs = params.toString();
    const response = await authenticatedFetch(`${BASE}/channels/${qs ? '?' + qs : ''}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch channels (${response.status})`);
    }
    return response.json();
  },

  /**
   * @deprecated Track E — use enumerationService.getTenants().
   * Legacy endpoint retained for backward compat; removal in cleanup track.
   */
  getTenants: async () => {
    const response = await authenticatedFetch(`${BASE}/tenants/`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch tenants (${response.status})`);
    }
    return response.json();
  },
};
