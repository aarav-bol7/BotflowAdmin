import { createElement, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Activity, AlertTriangle, Coins, Users, Zap, Radio, Clock, Calendar,
  Search, X, Filter, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2,
  Play, Pause, ExternalLink, AlertCircle, RefreshCw, ArrowUpDown,
  MessageSquare, Phone, Globe, Mail, Send, Hash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { botAnalyticsService } from '../api/botAnalyticsService';
import { flowService } from '../api/flowService';
import { botflowWs } from '../api/botflowWebSocket';
import { getTenants as enumGetTenants } from '../api/enumerationService';

// ── Helpers ──────────────────────────────────────────────────────────────

const formatCompact = (n) => {
  if (n == null) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};

const formatCredits = (n) => {
  if (n == null || n === 0) return '0.00';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
};

const formatDuration = (seconds) => {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const timeAgo = (isoStr) => {
  if (!isoStr) return 'Never';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

const CHANNEL_ICONS = {
  whatsapp: Phone, telegram: Send, webhook: Globe, discord: Hash,
  email: Mail, sms: MessageSquare, facebook: Globe, instagram: Globe,
  rcs: MessageSquare, api: Zap, test: Zap,
};

const STATUS_BADGE = {
  active: { bg: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400', label: 'Active' },
  inactive: { bg: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400', label: 'Inactive' },
};

// ── Filter option constants ─────────────────────────────────────────────

const ACTIVITY_MODE_OPTIONS = [
  { value: 'all', label: 'All Activity' },
  { value: 'idle', label: 'Idle (no activity since)' },
  { value: 'active', label: 'Active (had activity within)' },
];

const ACTIVITY_PRESETS = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const ERROR_OPTIONS = [
  { value: 'all', label: 'All Errors' },
  { value: 'has_errors', label: 'Has Errors' },
  { value: 'api_key_failure', label: 'API Key Failure' },
  { value: 'execution_error', label: 'Execution Errors' },
  { value: 'webhook_failure', label: 'Webhook Failures' },
];

const CHANNEL_OPTIONS = [
  { value: 'all', label: 'All Channels' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'discord', label: 'Discord' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
];

const SORT_OPTIONS = [
  { value: 'last_activity', label: 'Last Activity' },
  { value: 'created_at', label: 'Created Date' },
  { value: 'total_tokens', label: 'Token Usage' },
  { value: 'credits_used', label: 'Credit Usage' },
  { value: 'bot_name', label: 'Bot Name' },
  { value: 'status', label: 'Status' },
];

const BOT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'chat', label: 'Chat' },
  { value: 'voice', label: 'Voice' },
  { value: 'both', label: 'Both' },
];

const TOKEN_USAGE_OPTIONS = [
  { value: 'all', label: 'Tokens: Any amount' },
  { value: 'high', label: 'Tokens: Heavy (over 100K used)' },
  { value: 'medium', label: 'Tokens: Moderate (10K-100K used)' },
  { value: 'low', label: 'Tokens: Light (under 10K used)' },
  { value: 'custom', label: 'Tokens: Custom range...' },
];


const MSG_VOLUME_OPTIONS = [
  { value: 'all', label: 'Messages/Day: Any' },
  { value: 'high', label: 'Messages/Day: Busy (over 100)' },
  { value: 'medium', label: 'Messages/Day: Normal (10-100)' },
  { value: 'low', label: 'Messages/Day: Quiet (under 10)' },
  { value: 'custom', label: 'Messages/Day: Custom range...' },
];

const TOKEN_RANGE_MAP = { high: ['100000', ''], medium: ['10000', '100000'], low: ['', '10000'] };
const MSG_VOLUME_RANGE_MAP = { high: ['100', ''], medium: ['10', '100'], low: ['', '10'] };

const DEFAULT_BOT_ANALYTICS_STATE = {
  search: '',
  activityMode: 'all',
  activityPreset: '7d',
  activitySince: '',
  activityEnd: '',
  statusFilter: 'all',
  errorsFilter: 'all',
  channelFilter: 'all',
  tenantFilter: 'all',
  botTypeFilter: 'all',
  tokenUsageFilter: 'all',
  customTokenMin: '',
  customTokenMax: '',
  msgVolumeFilter: 'all',
  customMsgMin: '',
  customMsgMax: '',
  startDate: '',
  endDate: '',
  sortField: 'last_activity',
  sortDirection: 'desc',
  page: 1,
};

const optionValues = (options) => new Set(options.map(o => o.value));
const ACTIVITY_MODE_VALUES = optionValues(ACTIVITY_MODE_OPTIONS);
const ACTIVITY_PRESET_VALUES = optionValues(ACTIVITY_PRESETS);
const STATUS_VALUES = optionValues(STATUS_OPTIONS);
const ERROR_VALUES = optionValues(ERROR_OPTIONS);
const CHANNEL_VALUES = optionValues(CHANNEL_OPTIONS);
const BOT_TYPE_VALUES = optionValues(BOT_TYPE_OPTIONS);
const TOKEN_USAGE_VALUES = optionValues(TOKEN_USAGE_OPTIONS);
const MSG_VOLUME_VALUES = optionValues(MSG_VOLUME_OPTIONS);
const SORT_VALUES = optionValues(SORT_OPTIONS);
const SORT_DIRECTION_VALUES = new Set(['asc', 'desc']);

const getQueryValue = (params, key, fallback = '') => params.get(key) || fallback;
const getOptionQueryValue = (params, key, allowedValues, fallback) => {
  const value = params.get(key);
  return value && allowedValues.has(value) ? value : fallback;
};
const getPageQueryValue = (params) => {
  const value = Number(params.get('page'));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_BOT_ANALYTICS_STATE.page;
};

const parseBotAnalyticsSearchParams = (params) => {
  const parsed = {
    search: getQueryValue(params, 'search'),
    activityMode: getOptionQueryValue(params, 'activity_mode', ACTIVITY_MODE_VALUES, DEFAULT_BOT_ANALYTICS_STATE.activityMode),
    activityPreset: getOptionQueryValue(params, 'activity_preset', ACTIVITY_PRESET_VALUES, DEFAULT_BOT_ANALYTICS_STATE.activityPreset),
    activitySince: getQueryValue(params, 'activity_since'),
    activityEnd: getQueryValue(params, 'activity_end'),
    statusFilter: getOptionQueryValue(params, 'status', STATUS_VALUES, DEFAULT_BOT_ANALYTICS_STATE.statusFilter),
    errorsFilter: getOptionQueryValue(params, 'errors', ERROR_VALUES, DEFAULT_BOT_ANALYTICS_STATE.errorsFilter),
    channelFilter: getOptionQueryValue(params, 'channel', CHANNEL_VALUES, DEFAULT_BOT_ANALYTICS_STATE.channelFilter),
    tenantFilter: getQueryValue(params, 'tenant_id', DEFAULT_BOT_ANALYTICS_STATE.tenantFilter),
    botTypeFilter: getOptionQueryValue(params, 'bot_type', BOT_TYPE_VALUES, DEFAULT_BOT_ANALYTICS_STATE.botTypeFilter),
    tokenUsageFilter: getOptionQueryValue(params, 'token_usage', TOKEN_USAGE_VALUES, DEFAULT_BOT_ANALYTICS_STATE.tokenUsageFilter),
    customTokenMin: getQueryValue(params, 'token_min'),
    customTokenMax: getQueryValue(params, 'token_max'),
    msgVolumeFilter: getOptionQueryValue(params, 'msg_volume', MSG_VOLUME_VALUES, DEFAULT_BOT_ANALYTICS_STATE.msgVolumeFilter),
    customMsgMin: getQueryValue(params, 'msg_min'),
    customMsgMax: getQueryValue(params, 'msg_max'),
    startDate: getQueryValue(params, 'start_date'),
    endDate: getQueryValue(params, 'end_date'),
    sortField: getOptionQueryValue(params, 'sort', SORT_VALUES, DEFAULT_BOT_ANALYTICS_STATE.sortField),
    sortDirection: getOptionQueryValue(params, 'direction', SORT_DIRECTION_VALUES, DEFAULT_BOT_ANALYTICS_STATE.sortDirection),
    page: getPageQueryValue(params),
  };
  const hasAdvancedFilter = parsed.activityMode !== 'all'
    || parsed.tokenUsageFilter !== 'all'
    || parsed.msgVolumeFilter !== 'all';
  parsed.showAdvanced = params.get('advanced') === '1' || hasAdvancedFilter;
  return parsed;
};

const setIfNotDefault = (params, key, value, defaultValue) => {
  if (value !== undefined && value !== null && value !== '' && value !== defaultValue) {
    params.set(key, String(value));
  }
};

// ── Date range helpers ─────────────────────────────────────────────────

const toLocalISO = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DATE_PRESETS = [
  { label: 'Last Hour',  offset: () => { const d = new Date(); d.setHours(d.getHours() - 1); return d; } },
  { label: 'Last Day',   offset: () => { const d = new Date(); d.setDate(d.getDate() - 1); return d; } },
  { label: 'Last Week',  offset: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d; } },
  { label: 'Last Month', offset: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; } },
  { label: 'Last 90 Days', offset: () => { const d = new Date(); d.setDate(d.getDate() - 90); return d; } },
  { label: 'Last Year', offset: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; } },
];

// ── Main Component ──────────────────────────────────────────────────────

function BotAnalytics() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialUrlStateRef = useRef(null);
  if (initialUrlStateRef.current === null) {
    initialUrlStateRef.current = parseBotAnalyticsSearchParams(searchParams);
  }
  const initialUrlState = initialUrlStateRef.current;

  // Data
  const [summary, setSummary] = useState(null);
  const [globalBotCount, setGlobalBotCount] = useState(0);
  const [bots, setBots] = useState([]);
  const [total, setTotal] = useState(0);
  const [tenantList, setTenantList] = useState([]);

  // Loading / Error
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState(null);

  // Primary filters
  const [search, setSearch] = useState(initialUrlState.search);
  const [debouncedSearch, setDebouncedSearch] = useState(initialUrlState.search);
  const [activityMode, setActivityMode] = useState(initialUrlState.activityMode);
  const [activityPreset, setActivityPreset] = useState(initialUrlState.activityPreset);
  const [activitySince, setActivitySince] = useState(initialUrlState.activitySince);
  const [activityEnd, setActivityEnd] = useState(initialUrlState.activityEnd);
  const [statusFilter, setStatusFilter] = useState(initialUrlState.statusFilter);
  const [errorsFilter, setErrorsFilter] = useState(initialUrlState.errorsFilter);
  const [channelFilter, setChannelFilter] = useState(initialUrlState.channelFilter);
  const [page, setPage] = useState(initialUrlState.page);
  const pageSize = 20;

  // Sort (Issue 1)
  const [sortField, setSortField] = useState(initialUrlState.sortField);
  const [sortDirection, setSortDirection] = useState(initialUrlState.sortDirection);

  // Advanced filters (Issue 8)
  const [showAdvanced, setShowAdvanced] = useState(initialUrlState.showAdvanced);
  const [tenantFilter, setTenantFilter] = useState(initialUrlState.tenantFilter);
  const [botTypeFilter, setBotTypeFilter] = useState(initialUrlState.botTypeFilter);
  const [tokenUsageFilter, setTokenUsageFilter] = useState(initialUrlState.tokenUsageFilter);
  const [customTokenMin, setCustomTokenMin] = useState(initialUrlState.customTokenMin);
  const [customTokenMax, setCustomTokenMax] = useState(initialUrlState.customTokenMax);
  const [msgVolumeFilter, setMsgVolumeFilter] = useState(initialUrlState.msgVolumeFilter);
  const [customMsgMin, setCustomMsgMin] = useState(initialUrlState.customMsgMin);
  const [customMsgMax, setCustomMsgMax] = useState(initialUrlState.customMsgMax);

  // Date range filter (raw = input values, applied = triggers fetch)
  const [startDate, setStartDate] = useState(initialUrlState.startDate);
  const [endDate, setEndDate] = useState(initialUrlState.endDate);
  const [appliedStartDate, setAppliedStartDate] = useState(initialUrlState.startDate);
  const [appliedEndDate, setAppliedEndDate] = useState(initialUrlState.endDate);

  // WebSocket
  const [wsConnected, setWsConnected] = useState(false);
  const wsConnectedRef = useRef(false);
  const pollingRef = useRef(null);
  const pollDelayRef = useRef(null);
  const statsDebounceRef = useRef(null);
  const isInitialFetchPendingRef = useRef(true);
  const hasPendingEventRef = useRef(false);
  const debouncedRefetchRef = useRef(null);
  const searchDebounceRef = useRef(null);

  // Action state
  const [togglingStatus, setTogglingStatus] = useState(null);

  // Guards
  const mountedRef = useRef(false);
  const skipPageFetchRef = useRef(false);
  const filterEffectReadyRef = useRef(false);
  const pageEffectReadyRef = useRef(false);

  // ── Derived filter params ─────────────────────────────────────────
  const getFilterParams = useCallback(() => {
    const params = {
      search: debouncedSearch,
      status: statusFilter,
      errors: errorsFilter,
      channel: channelFilter,
    };

    // Activity filter: mode (all/idle/active) + preset (1h/24h/7d/30d/90d/custom)
    if (activityMode !== 'all') {
      if (activityPreset === 'custom') {
        // Custom date — either single date or range (if both filled)
        if (activitySince && activityEnd) {
          params.activitySince = activitySince;
          params.activityUntil = activityEnd;
        } else if (activitySince) {
          params.activitySince = activitySince;
          params.activityMode = activityMode === 'idle' ? 'inactive' : 'active';
        }
      } else {
        // Preset: combine mode + preset into e.g. "idle_7d" or "active_24h"
        params.activity = `${activityMode}_${activityPreset}`;
      }
    }

    // Advanced filters
    if (tenantFilter !== 'all') params.tenantId = tenantFilter;
    if (botTypeFilter !== 'all') params.botType = botTypeFilter;
    if (tokenUsageFilter === 'custom') {
      if (customTokenMin) params.tokenMin = customTokenMin;
      if (customTokenMax) params.tokenMax = customTokenMax;
    } else if (tokenUsageFilter !== 'all') {
      const [min, max] = TOKEN_RANGE_MAP[tokenUsageFilter] || ['', ''];
      if (min) params.tokenMin = min;
      if (max) params.tokenMax = max;
    }
    if (msgVolumeFilter === 'custom') {
      if (customMsgMin) params.msgMin = customMsgMin;
      if (customMsgMax) params.msgMax = customMsgMax;
    } else if (msgVolumeFilter !== 'all') {
      params.msgVolume = msgVolumeFilter;
    }

    // Date range filter
    if (appliedStartDate) params.startDate = appliedStartDate;
    if (appliedEndDate) params.endDate = appliedEndDate;

    return params;
  }, [debouncedSearch, activityMode, activityPreset, activitySince, activityEnd,
      statusFilter, errorsFilter, channelFilter,
      tenantFilter, botTypeFilter, tokenUsageFilter, customTokenMin, customTokenMax,
      msgVolumeFilter, customMsgMin, customMsgMax,
      appliedStartDate, appliedEndDate]);

  const buildRestorableSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    setIfNotDefault(params, 'search', search, DEFAULT_BOT_ANALYTICS_STATE.search);
    setIfNotDefault(params, 'tenant_id', tenantFilter, DEFAULT_BOT_ANALYTICS_STATE.tenantFilter);
    setIfNotDefault(params, 'status', statusFilter, DEFAULT_BOT_ANALYTICS_STATE.statusFilter);
    setIfNotDefault(params, 'errors', errorsFilter, DEFAULT_BOT_ANALYTICS_STATE.errorsFilter);
    setIfNotDefault(params, 'bot_type', botTypeFilter, DEFAULT_BOT_ANALYTICS_STATE.botTypeFilter);
    setIfNotDefault(params, 'channel', channelFilter, DEFAULT_BOT_ANALYTICS_STATE.channelFilter);
    setIfNotDefault(params, 'activity_mode', activityMode, DEFAULT_BOT_ANALYTICS_STATE.activityMode);
    if (activityMode !== 'all') {
      setIfNotDefault(params, 'activity_preset', activityPreset, DEFAULT_BOT_ANALYTICS_STATE.activityPreset);
      setIfNotDefault(params, 'activity_since', activitySince, DEFAULT_BOT_ANALYTICS_STATE.activitySince);
      setIfNotDefault(params, 'activity_end', activityEnd, DEFAULT_BOT_ANALYTICS_STATE.activityEnd);
    }
    setIfNotDefault(params, 'token_usage', tokenUsageFilter, DEFAULT_BOT_ANALYTICS_STATE.tokenUsageFilter);
    if (tokenUsageFilter === 'custom') {
      setIfNotDefault(params, 'token_min', customTokenMin, DEFAULT_BOT_ANALYTICS_STATE.customTokenMin);
      setIfNotDefault(params, 'token_max', customTokenMax, DEFAULT_BOT_ANALYTICS_STATE.customTokenMax);
    }
    setIfNotDefault(params, 'msg_volume', msgVolumeFilter, DEFAULT_BOT_ANALYTICS_STATE.msgVolumeFilter);
    if (msgVolumeFilter === 'custom') {
      setIfNotDefault(params, 'msg_min', customMsgMin, DEFAULT_BOT_ANALYTICS_STATE.customMsgMin);
      setIfNotDefault(params, 'msg_max', customMsgMax, DEFAULT_BOT_ANALYTICS_STATE.customMsgMax);
    }
    setIfNotDefault(params, 'start_date', appliedStartDate, DEFAULT_BOT_ANALYTICS_STATE.startDate);
    setIfNotDefault(params, 'end_date', appliedEndDate, DEFAULT_BOT_ANALYTICS_STATE.endDate);
    setIfNotDefault(params, 'sort', sortField, DEFAULT_BOT_ANALYTICS_STATE.sortField);
    setIfNotDefault(params, 'direction', sortDirection, DEFAULT_BOT_ANALYTICS_STATE.sortDirection);
    setIfNotDefault(params, 'page', page, DEFAULT_BOT_ANALYTICS_STATE.page);
    if (showAdvanced && (activityMode === 'all' && tokenUsageFilter === 'all' && msgVolumeFilter === 'all')) {
      params.set('advanced', '1');
    }
    return params;
  }, [search, tenantFilter, statusFilter, errorsFilter, botTypeFilter, channelFilter,
      activityMode, activityPreset, activitySince, activityEnd,
      tokenUsageFilter, customTokenMin, customTokenMax,
      msgVolumeFilter, customMsgMin, customMsgMax,
      appliedStartDate, appliedEndDate, sortField, sortDirection, page, showAdvanced]);

  const getReturnToUrl = useCallback(() => {
    const params = buildRestorableSearchParams();
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}`;
  }, [buildRestorableSearchParams, location.pathname]);

  const buildHandoffUrl = useCallback((path, entries) => {
    const params = new URLSearchParams(entries);
    params.set('returnTo', getReturnToUrl());
    return `${path}?${params.toString()}`;
  }, [getReturnToUrl]);

  // ── Fetch functions ───────────────────────────────────────────────

  const fetchSummary = useCallback(async (silent = false) => {
    try {
      if (!silent) setSummaryLoading(true);
      const data = await botAnalyticsService.getSummary(getFilterParams());
      setSummary(data.summary);
      if (data.globalBotCount != null) setGlobalBotCount(data.globalBotCount);
    } catch (err) {
      if (!silent) toast.error('Failed to load summary');
      console.error('fetchSummary:', err);
    } finally {
      if (!silent) setSummaryLoading(false);
    }
  }, [getFilterParams]);

  const fetchBots = useCallback(async (pageNum, silent = false) => {
    try {
      if (!silent) { setLoading(true); setError(null); }
      const ordering = `${sortDirection === 'desc' ? '-' : ''}${sortField}`;
      const data = await botAnalyticsService.getBots({
        ...getFilterParams(),
        page: pageNum,
        pageSize,
        ordering,
      });
      setBots(data.bots || []);
      const newTotal = data.total || 0;
      setTotal(newTotal);
      // Clamp: a WS-triggered refetch may shrink the result set below the
      // user's current page (e.g., bot.deleted removed enough rows). Reset
      // to page 1 and suppress the page-effect's redundant follow-up fetch.
      if (pageRef.current > 1 && Math.ceil(newTotal / pageSize) < pageRef.current) {
        skipPageFetchRef.current = true;
        pageRef.current = 1;
        setPage(1);
      }
    } catch (err) {
      if (!silent) { setError(err.message); setBots([]); setTotal(0); }
      console.error('fetchBots:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [getFilterParams, sortField, sortDirection]);

  const fetchAll = useCallback(() => {
    fetchSummary();
    fetchBots(1);
  }, [fetchSummary, fetchBots]);

  // Refs so WS handlers always call the LATEST fetch functions (not stale closures)
  const fetchSummaryRef = useRef(fetchSummary);
  const fetchBotsRef = useRef(fetchBots);
  useEffect(() => { fetchSummaryRef.current = fetchSummary; }, [fetchSummary]);
  useEffect(() => { fetchBotsRef.current = fetchBots; }, [fetchBots]);
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);
  // Mirror tenant filter so the WS scope guard reads the latest value
  // without re-binding the subscription lifecycle on filter change.
  const tenantFilterRef = useRef(tenantFilter);
  useEffect(() => { tenantFilterRef.current = tenantFilter; }, [tenantFilter]);

  // ── Initial load ──────────────────────────────────────────────────
  // mountedRef flips synchronously so filter-change effects don't dead-zone
  // during init. isInitialFetchPendingRef gates WS refetches; events arriving
  // mid-init set hasPendingEventRef and are replayed once the fetch settles.
  useEffect(() => {
    mountedRef.current = true;
    // Track E: unified tenant enumeration via cached service.
    enumGetTenants()
      .then(d => setTenantList(d.tenants || []))
      .catch(() => {});
    (async () => {
      try {
        await Promise.all([fetchSummary(), fetchBots(pageRef.current || 1)]);
      } finally {
        isInitialFetchPendingRef.current = false;
        if (hasPendingEventRef.current) {
          hasPendingEventRef.current = false;
          debouncedRefetchRef.current?.();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Search debounce ───────────────────────────────────────────────
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search]);

  // ── All filter deps (primary + advanced + sort) ───────────────────
  const filterDeps = [debouncedSearch, activityMode, activityPreset, activitySince, activityEnd,
    statusFilter, errorsFilter, channelFilter,
    tenantFilter, botTypeFilter, tokenUsageFilter, customTokenMin, customTokenMax,
    msgVolumeFilter, customMsgMin, customMsgMax,
    sortField, sortDirection,
    appliedStartDate, appliedEndDate];

  const currentQueryString = searchParams.toString();
  useEffect(() => {
    const nextParams = buildRestorableSearchParams();
    const nextQueryString = nextParams.toString();
    if (nextQueryString !== currentQueryString) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [buildRestorableSearchParams, currentQueryString, setSearchParams]);

  // ── Refetch on filter/sort change ─────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!filterEffectReadyRef.current) {
      filterEffectReadyRef.current = true;
      return;
    }
    // Supersede any pending WS-debounced refetch — it would refetch with
    // the *new* filter 500ms from now, duplicating the fetch below.
    if (statsDebounceRef.current) { clearTimeout(statsDebounceRef.current); statsDebounceRef.current = null; }
    skipPageFetchRef.current = true;
    setPage(1);
    fetchSummary();
    fetchBots(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, filterDeps);

  // ── Refetch on pagination ─────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!pageEffectReadyRef.current) {
      pageEffectReadyRef.current = true;
      return;
    }
    if (skipPageFetchRef.current) { skipPageFetchRef.current = false; return; }
    fetchBots(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // ── WebSocket integration ─────────────────────────────────────────
  // Single empty-deps effect. Handlers capture only refs, state setters,
  // and the WS singleton — no component-scope closures that could go stale.
  useEffect(() => {
    const POLL_INTERVAL = 15000;
    const POLL_START_DELAY = 20000;
    const DEBOUNCE_MS = 500;

    // Tenant-scope guard: 'all' or empty passes; otherwise payload must match.
    // Payloads without tenant_id pass conservatively (can't scope reliably).
    const shouldHandleEvent = (payload) => {
      const tf = tenantFilterRef.current;
      return !tf || tf === 'all' || !payload?.tenant_id || payload.tenant_id === tf;
    };

    const debouncedRefetch = () => {
      // Defer events that land during the initial mount fetch; the mount
      // effect's finally replays one refetch once init settles.
      if (isInitialFetchPendingRef.current) {
        hasPendingEventRef.current = true;
        return;
      }
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      statsDebounceRef.current = setTimeout(() => {
        fetchSummaryRef.current(true);
        fetchBotsRef.current(pageRef.current, true);
      }, DEBOUNCE_MS);
    };
    debouncedRefetchRef.current = debouncedRefetch;

    const handleScopedEvent = (payload) => {
      if (!shouldHandleEvent(payload)) return;
      debouncedRefetch();
    };

    botflowWs.connect();

    const offConnected = botflowWs.on('connected', () => {
      if (!wsConnectedRef.current) setWsConnected(true);
      wsConnectedRef.current = true;
      if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    });

    const offDisconnected = botflowWs.on('disconnected', () => {
      wsConnectedRef.current = false;
      setWsConnected(false);
      // Pre-clear so disconnect flapping can't stack delay timers.
      if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }
      pollDelayRef.current = setTimeout(() => {
        if (!wsConnectedRef.current && !pollingRef.current) {
          pollingRef.current = setInterval(() => {
            fetchSummaryRef.current(true);
            fetchBotsRef.current(pageRef.current, true);
          }, POLL_INTERVAL);
        }
      }, POLL_START_DELAY);
    });

    // Track B: summary + bot list are aggregated views; since_ts catch-up
    // does not apply. Intentional blind refetch.
    const offReconnected = botflowWs.on('reconnected', () => {
      wsConnectedRef.current = true;
      setWsConnected(true);
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      if (statsDebounceRef.current) { clearTimeout(statsDebounceRef.current); statsDebounceRef.current = null; }
      hasPendingEventRef.current = false;
      fetchSummaryRef.current(true);
      fetchBotsRef.current(pageRef.current, true);
    });

    // Status change: optimistic row patch (instant UX) + debounced full refetch
    // so filter membership stays correct. Track F will replace both with a
    // smarter in-place update.
    const offStatusChanged = botflowWs.on('bot.status_changed', (payload) => {
      if (!shouldHandleEvent(payload)) return;
      if (payload?.bot_key) {
        setBots(prev => prev.map(b =>
          b.botKey === payload.bot_key && b.tenantId === payload.tenant_id
            ? { ...b, status: payload.status } : b
        ));
      }
      debouncedRefetch();
    });

    const offBotCreated = botflowWs.on('bot.created', handleScopedEvent);
    const offBotUpdated = botflowWs.on('bot.updated', handleScopedEvent);
    const offBotDeleted = botflowWs.on('bot.deleted', handleScopedEvent);
    const offBotConfigUpdated = botflowWs.on('bot.config_updated', handleScopedEvent);
    const offStats = botflowWs.on('stats.updated', handleScopedEvent);
    const offCredits = botflowWs.on('credits.deducted', handleScopedEvent);
    const offExecCompleted = botflowWs.on('execution.completed', handleScopedEvent);
    const offFlowUpdated = botflowWs.on('flow.updated', handleScopedEvent);
    const offFlowPublished = botflowWs.on('flow.published', handleScopedEvent);
    const offFlowDeleted = botflowWs.on('flow.deleted', handleScopedEvent);

    return () => {
      offConnected(); offDisconnected(); offReconnected();
      offStatusChanged();
      offBotCreated(); offBotUpdated(); offBotDeleted(); offBotConfigUpdated();
      offStats(); offCredits(); offExecCompleted();
      offFlowUpdated(); offFlowPublished(); offFlowDeleted();
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      if (pollDelayRef.current) clearTimeout(pollDelayRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
      debouncedRefetchRef.current = null;
      botflowWs.disconnect();
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────

  const handleToggleStatus = async (bot) => {
    const newStatus = bot.status === 'active' ? 'inactive' : 'active';
    setTogglingStatus(bot.botKey);
    try {
      await flowService.setStatus(bot.botKey, bot.tenantId, newStatus);
      setBots(prev => prev.map(b =>
        b.botKey === bot.botKey && b.tenantId === bot.tenantId ? { ...b, status: newStatus } : b
      ));
      toast.success(`Bot ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setTogglingStatus(null);
    }
  };

  const clearFilters = () => {
    setSearch(''); setDebouncedSearch('');
    setActivityMode('all'); setActivityPreset('7d'); setActivitySince(''); setActivityEnd('');
    setStatusFilter('all'); setErrorsFilter('all'); setChannelFilter('all');
    setTenantFilter('all'); setBotTypeFilter('all'); setTokenUsageFilter('all');
    setCustomTokenMin(''); setCustomTokenMax('');
    setMsgVolumeFilter('all');
    setCustomMsgMin(''); setCustomMsgMax('');
    setStartDate(''); setEndDate('');
    setAppliedStartDate(''); setAppliedEndDate('');
    setPage(1);
  };

  const applyDateFilter = (sd, ed) => {
    setAppliedStartDate(sd || startDate);
    setAppliedEndDate(ed || endDate);
  };

  const clearDateFilter = () => {
    setStartDate('');
    setEndDate('');
    setAppliedStartDate('');
    setAppliedEndDate('');
  };

  const hasActiveFilters = debouncedSearch || tenantFilter !== 'all' || statusFilter !== 'all' || errorsFilter !== 'all' || channelFilter !== 'all' || botTypeFilter !== 'all' || appliedStartDate || appliedEndDate;
  const advancedFilterCount = [activityMode, tokenUsageFilter, msgVolumeFilter].filter(v => v !== 'all').length;
  const hasAnyFilter = hasActiveFilters || advancedFilterCount > 0;
  const totalPages = Math.ceil(total / pageSize);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* ── Connection status + header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs text-slate-500 dark:text-slate-400">{wsConnected ? 'Live' : 'Disconnected'}</span>
        </div>
        <button onClick={fetchAll} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* ── Disconnect banner ── */}
      {!wsConnected && (
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4" /> Real-time updates paused — reconnecting...
          </div>
          <button onClick={fetchAll} className="px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 rounded-md hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors">Refresh Now</button>
        </div>
      )}

      {/* ── Date range filter ── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400 shrink-0 hidden sm:block" />
          <input type="datetime-local" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          <span className="text-sm font-medium text-slate-400">to</span>
          <input type="datetime-local" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          <select value="" onChange={(e) => {
            const idx = Number(e.target.value);
            if (isNaN(idx)) return;
            const preset = DATE_PRESETS[idx];
            const sd = toLocalISO(preset.offset());
            const ed = toLocalISO(new Date());
            setStartDate(sd);
            setEndDate(ed);
            applyDateFilter(sd, ed);
          }}
            className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
            <option value="" disabled>Quick select...</option>
            {DATE_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
          <button onClick={() => applyDateFilter()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
            Apply
          </button>
          {(startDate || endDate) && (
            <button onClick={clearDateFilter}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title="Clear date filter">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Summary cards ── */}
      {hasAnyFilter && summary && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {summary.bots.total} of {globalBotCount} bots
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryLoading && !summary ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 animate-pulse">
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded mb-3" />
              <div className="h-7 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
          ))
        ) : summary ? (
          <>
            <SummaryCard icon={Activity} label="Total Bots" value={summary.bots.total} color="indigo" />
            <SummaryCard icon={Zap} label="Token Usage" value={formatCompact(summary.tokens.total)} color="purple" />
            <SummaryCard icon={Coins} label="Credit Usage" value={formatCredits(summary.credits.totalUsed)} color="emerald" />
            <SummaryCard icon={Users} label="Unique Users" value={formatCompact(summary.users.total)} color="blue" />
            <SummaryCard icon={MessageSquare} label="Text Messages" value={formatCompact(summary.messages?.texts)} color="indigo" />
            <SummaryCard icon={Phone} label="Voice Calls" value={formatCompact(summary.messages?.calls)} color="purple" />
            <SummaryCard icon={Radio} label="Pulses" value={formatCompact(summary.messages?.pulses)} color="amber" />
            <SummaryCard icon={Clock} label="Call Duration" value={formatDuration(summary.messages?.callDuration)} color="slate" />
          </>
        ) : null}
      </div>

      {/* ── Primary filter bar ── */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="Search by bot name, key, or tenant..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors" />
        </div>
        <FilterSelect value={tenantFilter} onChange={setTenantFilter}
          options={[{ value: 'all', label: 'All Tenants' }, ...tenantList.map(t => ({ value: t.tenantId, label: t.tenantName || `Tenant ${t.tenantId.slice(0, 8)}` }))]} />
        <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
        {/* <FilterSelect value={errorsFilter} onChange={setErrorsFilter} options={ERROR_OPTIONS} /> */}
        <FilterSelect value={botTypeFilter} onChange={setBotTypeFilter} options={BOT_TYPE_OPTIONS} />
        <FilterSelect value={channelFilter} onChange={setChannelFilter} options={CHANNEL_OPTIONS} />
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className={`flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${showAdvanced ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
          <Filter className="w-3.5 h-3.5" />
          More{advancedFilterCount > 0 && <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-indigo-500 text-white rounded-full">{advancedFilterCount}</span>}
          {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {hasAnyFilter && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── Advanced filters row ── */}
      {showAdvanced && (
        <div className="flex flex-col gap-2 px-3 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
            <FilterSelect value={tokenUsageFilter} onChange={(v) => { setTokenUsageFilter(v); if (v !== 'custom') { setCustomTokenMin(''); setCustomTokenMax(''); } }} options={TOKEN_USAGE_OPTIONS} />
            <FilterSelect value={msgVolumeFilter} onChange={(v) => { setMsgVolumeFilter(v); if (v !== 'custom') { setCustomMsgMin(''); setCustomMsgMax(''); } }} options={MSG_VOLUME_OPTIONS} />
            <FilterSelect value={activityMode} onChange={setActivityMode} options={ACTIVITY_MODE_OPTIONS} />
            {activityMode !== 'all' && (
              <>
                {ACTIVITY_PRESETS.map((p) => (
                  <button key={p.value} onClick={() => setActivityPreset(p.value)}
                    className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors ${activityPreset === p.value
                      ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400'
                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                    {p.label}
                  </button>
                ))}
                {activityPreset === 'custom' && (
                  <>
                    <input type="datetime-local" value={activitySince} onChange={(e) => setActivitySince(e.target.value)}
                      className="px-2.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                    <span className="text-xs text-slate-400 self-center">to</span>
                    <input type="datetime-local" value={activityEnd} onChange={(e) => setActivityEnd(e.target.value)}
                      className="px-2.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                  </>
                )}
              </>
            )}
          </div>
          {/* Custom token range inputs */}
          {tokenUsageFilter === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Token range:</span>
              <input type="number" placeholder="Min tokens" value={customTokenMin} onChange={(e) => setCustomTokenMin(e.target.value)}
                className="w-28 px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              <span className="text-xs text-slate-400">to</span>
              <input type="number" placeholder="Max tokens" value={customTokenMax} onChange={(e) => setCustomTokenMax(e.target.value)}
                className="w-28 px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
          )}
          {/* Custom message volume range inputs */}
          {msgVolumeFilter === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Messages/day range:</span>
              <input type="number" placeholder="Min msgs/day" value={customMsgMin} onChange={(e) => setCustomMsgMin(e.target.value)}
                className="w-28 px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
              <span className="text-xs text-slate-400">to</span>
              <input type="number" placeholder="Max msgs/day" value={customMsgMax} onChange={(e) => setCustomMsgMax(e.target.value)}
                className="w-28 px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
          )}
        </div>
      )}

      {/* ── Sort control ── */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400">Sort by:</span>
        <select value={sortField} onChange={(e) => setSortField(e.target.value)}
          className="px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-white cursor-pointer">
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={() => setSortDirection(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          title={sortDirection === 'desc' ? 'Descending' : 'Ascending'}>
          <ArrowUpDown className="w-3 h-3" /> {sortDirection === 'desc' ? 'Desc' : 'Asc'}
        </button>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">{error}</div>
      )}

      {/* ── Bot cards ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-slate-500 dark:text-slate-400 text-lg font-medium mb-2">No bots match your filters</p>
          <p className="text-slate-400 dark:text-slate-500 text-sm mb-4">Try adjusting your search or filter criteria</p>
          {hasAnyFilter && <button onClick={clearFilters} className="px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors">Clear All Filters</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map((bot) => (
            <BotCard
              key={`${bot.tenantId}-${bot.botKey}`}
              bot={bot}
              togglingStatus={togglingStatus}
              onToggleStatus={handleToggleStatus}
              onViewErrors={() => navigate(buildHandoffUrl('/notifications', {
                tenant_id: bot.tenantId,
                bot_key: bot.botKey,
                severity: 'error',
              }))}
              onViewDetails={() => navigate(buildHandoffUrl('/bot', {
                tenantId: bot.tenantId,
                flowId: bot.botKey,
              }))}
              onViewChats={() => navigate(buildHandoffUrl('/chat-messages', {
                tenantId: bot.tenantId,
                botKey: bot.botKey,
              }))}
              onViewCalls={() => navigate(buildHandoffUrl('/call-details', {
                tenantId: bot.tenantId,
                botKey: bot.botKey,
              }))}
            />
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-slate-500 dark:text-slate-400">{page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

    </div>
  );
}

// ── Inline sub-components ───────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  const colorMap = {
    indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
    slate: 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50',
  };
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-lg ${colorMap[color] || colorMap.slate}`}>
          {createElement(Icon, { className: 'w-4 h-4' })}
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{sub}</div>}
    </div>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors cursor-pointer">
      {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  );
}

function BotCard({ bot, togglingStatus, onToggleStatus, onViewErrors, onViewDetails, onViewChats, onViewCalls }) {
  const badge = STATUS_BADGE[bot.status] || STATUS_BADGE.inactive;
  const isToggling = togglingStatus === bot.botKey;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 flex flex-col gap-3 hover:shadow-md dark:hover:shadow-slate-900/50 transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{bot.botName}</h4>
            {bot.isNew && <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded">NEW</span>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{bot.tenantName || bot.tenantId}</p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-full ${badge.bg}`}>{badge.label}</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <StatRow label="Last Active" value={timeAgo(bot.lastActivity)} />
        <StatRow label="Tokens" value={formatCompact(bot.tokens?.total)} />
        <StatRow label="Credits" value={formatCredits(bot.credits?.used) + (bot.credits?.pending > 0 ? ` (+${formatCredits(bot.credits.pending)})` : '')} />
        <StatRow label="Active Users" value={`${bot.uniqueUsers?.active24h || 0} / ${bot.uniqueUsers?.total || 0}`} />
        {bot.errors?.total > 0 && (
          <div className="col-span-2">
            <span className="text-red-600 dark:text-red-400 font-medium">{bot.errors.total} error{bot.errors.total !== 1 ? 's' : ''}</span>
            <span className="text-slate-400 dark:text-slate-500 ml-1">
              ({[bot.errors.apiKeyFailure > 0 && `${bot.errors.apiKeyFailure} API key`, bot.errors.executionError > 0 && `${bot.errors.executionError} exec`, bot.errors.webhookFailure > 0 && `${bot.errors.webhookFailure} webhook`].filter(Boolean).join(', ')})
            </span>
          </div>
        )}
      </div>

      {/* Last message */}
      {bot.lastMessage ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-md px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="capitalize font-medium text-slate-600 dark:text-slate-300">{bot.lastMessage.role}</span>
            <span className="text-slate-400">via {bot.lastMessage.channel}</span>
            <span className="ml-auto text-slate-400">{timeAgo(bot.lastMessage.timestamp)}</span>
          </div>
          <p className="truncate">{bot.lastMessage.content}</p>
        </div>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">No messages yet</p>
      )}

      {/* Last error / deactivation context */}
      {bot.lastError ? (
        <div className="text-xs bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-md px-2.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
            <span className="font-medium text-red-700 dark:text-red-400 truncate">
              {bot.status === 'inactive' ? 'Deactivated — ' : ''}{bot.lastError.title}
            </span>
            <span className="ml-auto text-red-400 shrink-0">{timeAgo(bot.lastError.timestamp)}</span>
          </div>
        </div>
      ) : bot.status === 'inactive' ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">Manually deactivated</p>
      ) : null}

      {/* Channels */}
      {bot.channels?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bot.channels.map((ch) => {
            const Icon = CHANNEL_ICONS[ch] || Globe;
            return <span key={ch} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded capitalize"><Icon className="w-3 h-3" />{ch}</span>;
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex-wrap">
        <button onClick={() => onToggleStatus(bot)} disabled={isToggling}
          className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${bot.status === 'active' ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30' : 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'} disabled:opacity-50`}>
          {isToggling ? <Loader2 className="w-3 h-3 animate-spin" /> : bot.status === 'active' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {bot.status === 'active' ? 'Deactivate' : 'Activate'}
        </button>
        <button onClick={onViewChats} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
          <MessageSquare className="w-3 h-3" /> Chats
        </button>
        <button onClick={onViewCalls} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
          <Phone className="w-3 h-3" /> Calls
        </button>
        {bot.errors?.total > 0 && (
          <button onClick={onViewErrors} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
            <AlertTriangle className="w-3 h-3" /> Errors
          </button>
        )}
        <button onClick={onViewDetails} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ml-auto">
          <ExternalLink className="w-3 h-3" /> Details
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

export default BotAnalytics;
