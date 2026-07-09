import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bell, Check, CheckCheck, Filter, AlertCircle, Info, AlertTriangle, RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { notificationService, notificationWs } from '../api/notificationService';
import { mergeById, performReconnectCatchup } from '../api/reconnectCatchup';
import { getTenants as enumGetTenants, getBotsByTenant as enumGetBotsByTenant } from '../api/enumerationService';

const SEVERITY_MAP = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'error',
};

const CATEGORY_LABELS = {
  webhook_failure: 'Webhooks',
  api_key_failure: 'API Keys',
  credit_warning: 'Credits',
  bot_stopped: 'Bot Status',
  execution_error: 'Execution',
  system_alert: 'System',
  bot_activity: 'Bot Activity',
  flow_activity: 'Flow Activity',
  knowledge_base: 'Knowledge Base',
  llm_quota_exceeded: 'Quota',
  llm_rate_limit: 'Rate Limit',
  llm_provider_error: 'Provider',
  llm_token_limit: 'Token Limit',
  llm_content_policy: 'Content Policy',
  channel_send_failure: 'Channel Send',
  flow_http_failure: 'HTTP Response',
  inbound_routing_failure: 'Inbound Routing',
  voice_handshake_failure: 'Voice Handshake',
  voice_billing_failure: 'Voice Billing',
  voice_provider_failure: 'Voice Provider',
  global_default_failure: 'Global Default',
  hitl_request: 'Human Handoff',
};

const SEVERITY_OPTIONS = [
  { value: '', label: 'All Severities' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'critical', label: 'Critical' },
];

const getInitialReadFilter = (params) => {
  const explicitFilter = params.get('filter');
  if (['all', 'unread', 'read'].includes(explicitFilter)) return explicitFilter;
  const isRead = params.get('is_read');
  if (isRead === 'false') return 'unread';
  if (isRead === 'true') return 'read';
  return 'all';
};

const getInitialSeverityFilter = (params) => {
  const severity = params.get('severity') || '';
  return SEVERITY_OPTIONS.some(option => option.value === severity) ? severity : '';
};

function Notifications() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/bot-analytics') ? returnTo : '/bot-analytics';
  const initialTenantFilter = searchParams.get('tenant_id') || searchParams.get('tenantId') || '';
  const initialBotFilter = searchParams.get('bot_key') || searchParams.get('botKey') || '';
  const [filter, setFilter] = useState(() => getInitialReadFilter(searchParams));
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const wsConnectedRef = useRef(false);

  // Tenant + bot filters
  const [tenantFilter, setTenantFilter] = useState(initialTenantFilter);
  const [botFilter, setBotFilter] = useState(initialBotFilter);
  const [severityFilter, setSeverityFilter] = useState(() => getInitialSeverityFilter(searchParams));
  const [tenantList, setTenantList] = useState([]);
  const [botList, setBotList] = useState([]);

  // Refs for WS handler to access latest filter values
  const tenantFilterRef = useRef('');
  const botFilterRef = useRef('');
  const severityFilterRef = useRef('');
  const filterRef = useRef('all');
  const pageRef = useRef(1);
  const notificationsRef = useRef([]);
  useEffect(() => { tenantFilterRef.current = tenantFilter; }, [tenantFilter]);
  useEffect(() => { botFilterRef.current = botFilter; }, [botFilter]);
  useEffect(() => { severityFilterRef.current = severityFilter; }, [severityFilter]);
  useEffect(() => { filterRef.current = filter; }, [filter]);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { notificationsRef.current = notifications; }, [notifications]);

  // Fetch tenant list on mount — Track E: unified + cached.
  useEffect(() => {
    enumGetTenants()
      .then(d => setTenantList(d.tenants || []))
      .catch(() => {});
  }, []);

  // Fetch bot list when tenant changes — Track E: cached per tenant.
  useEffect(() => {
    if (tenantFilter) {
      enumGetBotsByTenant(tenantFilter)
        .then(d => setBotList(d.bots || []))
        .catch(() => setBotList([]));
    } else {
      setBotList([]);
      setBotFilter('');
    }
  }, [tenantFilter]);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const filters = { page, page_size: pageSize };
      if (filter === 'unread') filters.is_read = 'false';
      if (filter === 'read') filters.is_read = 'true';
      if (tenantFilter) filters.tenant_id = tenantFilter;
      if (botFilter) filters.bot_key = botFilter;
      if (severityFilter) filters.severity = severityFilter;
      const data = await notificationService.fetchNotifications(filters);
      setNotifications(data.notifications || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error('Failed to load notifications');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, tenantFilter, botFilter, severityFilter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // WebSocket connection
  useEffect(() => {
    if (wsConnectedRef.current) return;

    notificationWs.connect();
    wsConnectedRef.current = true;

    const unsubNew = notificationWs.on('new_notification', (notification) => {
      // Only show if it matches active tenant/bot filters
      const tf = tenantFilterRef.current;
      const bf = botFilterRef.current;
      const sf = severityFilterRef.current;
      if (tf && notification.tenant_id !== tf) return;
      if (bf && notification.bot_key !== bf) return;
      if (sf && notification.severity !== sf) return;
      setNotifications(prev => [notification, ...prev]);
      setTotal(prev => prev + 1);
      toast(notification.title, {
        icon: notification.severity === 'error' || notification.severity === 'critical' ? '🔴' : notification.severity === 'warning' ? '🟡' : 'ℹ️',
        duration: 4000,
      });
    });

    const unsubUpdated = notificationWs.on('notification_updated', (updated) => {
      setNotifications(prev =>
        prev.map(n => n.id === updated.id ? updated : n)
      );
    });

    // Track B: catch up on gap events via since_ts. Skip on page > 1 so we
    // don't jarringly prepend rows while the user is browsing history.
    const unsubReconnected = notificationWs.on('reconnected', () => {
      const f = filterRef.current;
      const snapshot = {
        tenant_id: tenantFilterRef.current || undefined,
        bot_key: botFilterRef.current || undefined,
        severity: severityFilterRef.current || undefined,
        is_read: f === 'unread' ? 'false' : f === 'read' ? 'true' : undefined,
      };
      if (pageRef.current > 1) {
        fetchNotifications(); // blind; page > 1 is a history view
        return;
      }
      performReconnectCatchup({
        wsClient: notificationWs,
        catchupFetch: notificationService.fetchNotificationsCatchup,
        fullRefetch: () => fetchNotifications(),
        mergeFn: (items) => {
          const { merged, addedCount } = mergeById(notificationsRef.current, items, n => n.id);
          if (addedCount > 0) {
            setNotifications(merged);
            setTotal(prev => prev + addedCount);
          }
        },
        filters: snapshot,
      }).catch((err) => {
        console.warn('[Notifications] catch-up failed:', err);
      });
    });

    return () => {
      unsubNew();
      unsubUpdated();
      unsubReconnected();
      notificationWs.disconnect();
      wsConnectedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getNotificationIcon = (severity) => {
    const mapped = SEVERITY_MAP[severity] || 'info';
    switch (mapped) {
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
      default:
        return <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
    }
  };

  const getNotificationBgColor = (severity, isRead) => {
    if (isRead) return 'bg-slate-50 dark:bg-slate-800/30';
    const mapped = SEVERITY_MAP[severity] || 'info';
    switch (mapped) {
      case 'error':
        return 'bg-red-50 dark:bg-red-900/20 border-l-red-500';
      case 'warning':
        return 'bg-orange-50 dark:bg-orange-900/20 border-l-orange-500';
      default:
        return 'bg-blue-50 dark:bg-blue-900/20 border-l-blue-500';
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAsRead = async (id) => {
    try {
      await notificationService.markRead([id]);
      setNotifications(prev => prev.map(n =>
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      ));
    } catch {
      toast.error('Failed to mark as read');
    }
  };

  const markAllAsRead = async () => {
    try {
      // Scope to current filters so only visible notifications are marked
      const params = {};
      if (tenantFilter) params.tenant_id = tenantFilter;
      if (botFilter) params.bot_key = botFilter;
      if (severityFilter) params.severity = severityFilter;
      await notificationService.markAllRead(params);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  const markAsUnread = async (id) => {
    setNotifications(prev => prev.map(n =>
      n.id === id ? { ...n, is_read: false, read_at: null } : n
    ));
  };

  const handleTenantChange = (value) => {
    setTenantFilter(value);
    setBotFilter('');
    setPage(1);
  };

  const handleBotChange = (value) => {
    setBotFilter(value);
    setPage(1);
  };

  const handleSeverityChange = (value) => {
    setSeverityFilter(value);
    setPage(1);
  };


  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-2">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="px-2.5 py-1 bg-indigo-600 text-white text-xs sm:text-sm font-medium rounded-full">
                {unreadCount} unread
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            {returnTo && (
              <button
                type="button"
                onClick={() => navigate(safeReturnTo)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Back to Bot Analytics</span>
                <span className="sm:hidden">Back</span>
              </button>
            )}
            <button
              onClick={fetchNotifications}
              className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
              >
                <CheckCheck className="w-4 h-4" />
                <span className="hidden sm:inline">Mark all as read</span>
                <span className="sm:hidden">Mark all read</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-5 h-5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
          <div className="flex gap-2 flex-1 sm:flex-initial overflow-x-auto pb-2 sm:pb-0">
            {['all', 'unread', 'read'].map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                  filter === f
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
                }`}
              >
                {f} {f === 'all' ? `(${total})` : ''}
              </button>
            ))}
          </div>
        </div>
        {/* Tenant + Bot dropdowns */}
        <select
          value={tenantFilter}
          onChange={(e) => handleTenantChange(e.target.value)}
          className="px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors cursor-pointer"
        >
          <option value="">All Tenants</option>
          {tenantFilter && !tenantList.some(t => t.tenantId === tenantFilter) && (
            <option value={tenantFilter}>{tenantFilter}</option>
          )}
          {tenantList.map((t) => (
            <option key={t.tenantId} value={t.tenantId}>
              {t.tenantName || `Tenant ${t.tenantId.slice(0, 8)}`}
            </option>
          ))}
        </select>
        {tenantFilter && (
          <select
            value={botFilter}
            onChange={(e) => handleBotChange(e.target.value)}
            className="px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors cursor-pointer"
          >
            <option value="">All Bots</option>
            {botFilter && !botList.some(b => b.botKey === botFilter) && (
              <option value={botFilter}>{botFilter}</option>
            )}
            {botList.map((b) => (
              <option key={b.botKey} value={b.botKey}>
                {b.botName || b.botKey}
              </option>
            ))}
          </select>
        )}
        <select
          value={severityFilter}
          onChange={(e) => handleSeverityChange(e.target.value)}
          className="px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors cursor-pointer"
        >
          {SEVERITY_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && notifications.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
      )}

      {/* Notifications List */}
      <div className="space-y-3">
        {!loading && notifications.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-12 text-center">
            <Bell className="w-12 h-12 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400 font-medium">
              {filter === 'unread'
                ? 'No unread notifications'
                : filter === 'read'
                ? 'No read notifications'
                : tenantFilter || botFilter || severityFilter
                ? 'No notifications for this selection'
                : 'No notifications yet'}
            </p>
          </div>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden transition-all duration-200 hover:shadow-lg ${
                !notification.is_read ? 'border-l-4' : ''
              } ${getNotificationBgColor(notification.severity, notification.is_read)}`}
            >
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {getNotificationIcon(notification.severity)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className={`font-semibold text-slate-900 dark:text-white ${
                            !notification.is_read ? 'font-bold' : ''
                          }`}>
                            {notification.title}
                          </h3>
                          {!notification.is_read && (
                            <span className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></span>
                          )}
                          {notification.occurrence_count > 1 && (
                            <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-mono rounded">
                              x{notification.occurrence_count}
                            </span>
                          )}
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs rounded">
                            {CATEGORY_LABELS[notification.category] || notification.category}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-500 flex-wrap">
                          <span>{formatTimestamp(notification.created_at)}</span>
                          {(notification.tenant_name || notification.tenant_id) && (
                            <span className="text-slate-400 dark:text-slate-500" title={notification.tenant_id}>
                              Tenant: <span className="font-medium text-slate-600 dark:text-slate-300">{notification.tenant_name || notification.tenant_id.substring(0, 12) + '...'}</span>
                            </span>
                          )}
                          {(notification.bot_name || notification.bot_key) && (
                            <span className="text-slate-400 dark:text-slate-500" title={notification.bot_key}>
                              Bot: <span className="font-medium text-slate-600 dark:text-slate-300">{notification.bot_name || notification.bot_key}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {notification.is_read ? (
                          <button
                            onClick={() => markAsUnread(notification.id)}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                            title="Mark as unread"
                          >
                            <Bell className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="p-2 text-slate-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                            title="Mark as read"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Stats + Pagination */}
      {notifications.length > 0 && (
        <div className="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} notification{total !== 1 ? 's' : ''}
          </p>
          {total > pageSize && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1 || loading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-sm text-slate-500 dark:text-slate-400">{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
              <button
                onClick={() => setPage(Math.min(Math.ceil(total / pageSize), page + 1))}
                disabled={page >= Math.ceil(total / pageSize) || loading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Notifications;
