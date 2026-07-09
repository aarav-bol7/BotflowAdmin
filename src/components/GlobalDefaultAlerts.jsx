import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, CheckCheck, Brain, Mic, X } from 'lucide-react';
import { notificationService, notificationWs } from '../api/notificationService';

// Cross-component nudge: deletion doesn't ride the notification WS, so the
// bell and this panel tell each other to refetch after a dismiss.
export const GD_ALERTS_CHANGED = 'gd-alerts-changed';

// Deep-dive panel for platform-level Global Default model failures
// (category global_default_failure): the bell shows the last few, this panel
// shows them in context on the tab where the admin actually fixes the key.
const CATEGORY = 'global_default_failure';

const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

const ServiceChip = ({ service }) => {
  if (!service) return null;
  const isVoice = service === 'voice';
  const Icon = isVoice ? Mic : Brain;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
      isVoice
        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    }`}>
      <Icon className="w-3 h-3" /> {service}
    </span>
  );
};

function GlobalDefaultAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const refresh = useCallback(() => {
    notificationService.fetchNotifications({ category: CATEGORY, page_size: 20 })
      .then((data) => setAlerts(data.notifications || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    notificationWs.connect();
    const onEvent = (n) => { if (n && n.category === CATEGORY) refresh(); };
    const offNew = notificationWs.on('new_notification', onEvent);
    const offUpd = notificationWs.on('notification_updated', onEvent);
    const offReconnect = notificationWs.on('reconnected', refresh);
    const onChanged = () => refresh();
    window.addEventListener(GD_ALERTS_CHANGED, onChanged);
    return () => {
      offNew(); offUpd(); offReconnect();
      window.removeEventListener(GD_ALERTS_CHANGED, onChanged);
    };
  }, [refresh]);

  const dismiss = (a, e) => {
    e.stopPropagation();
    notificationService.deleteNotification(a.id)
      .then(() => {
        setAlerts((prev) => prev.filter((x) => x.id !== a.id));
        window.dispatchEvent(new CustomEvent(GD_ALERTS_CHANGED));
      })
      .catch(() => {});
  };

  const unread = alerts.filter((a) => !a.is_read);

  const markOneRead = (a) => {
    if (a.is_read) return;
    notificationService.markRead([a.id])
      .then(() => setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_read: true } : x))))
      .catch(() => {});
  };

  const markAllRead = () => {
    setMarking(true);
    notificationService.markAllRead({ category: CATEGORY })
      .then(() => setAlerts((prev) => prev.map((x) => ({ ...x, is_read: true }))))
      .catch(() => {})
      .finally(() => setMarking(false));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        <span className="text-sm text-slate-500 dark:text-slate-400">Checking default model health…</span>
      </div>
    );
  }

  // Healthy state: keep it visible but slim, so the admin knows this surface
  // exists and that silence means "no failures", not "not wired".
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40">
        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
        <p className="text-sm text-green-800 dark:text-green-300">
          No Global Default model failures — chat and voice default credentials are working.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/50 overflow-hidden">
      <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
            Default model alerts
            {unread.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white">
                {unread.length} new
              </span>
            )}
          </h3>
        </div>
        {unread.length > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
        {alerts.map((a) => {
          const md = a.metadata || {};
          return (
            <div
              key={a.id}
              onClick={() => markOneRead(a)}
              className={`px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                !a.is_read ? 'bg-red-50/40 dark:bg-red-950/10' : ''
              }`}
              title={a.is_read ? '' : 'Click to mark as read'}
            >
              <div className="flex items-start gap-3">
                <Info className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                  a.severity === 'critical' || a.severity === 'error'
                    ? 'text-red-500' : 'text-yellow-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{a.title}</span>
                    <ServiceChip service={md.service} />
                    {md.provider && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {md.provider}{md.model ? ` · ${md.model}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{a.message}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    {timeAgo(a.last_occurred_at || a.created_at)}
                    {a.occurrence_count > 1 ? ` · ${a.occurrence_count} occurrences` : ''}
                    {a.bot_name ? ` · first seen on ${a.bot_name}` : ''}
                    {md.error_code ? ` · ${md.error_code}` : ''}
                  </p>
                </div>
                {!a.is_read && <div className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0 mt-1.5" />}
                <button
                  onClick={(e) => dismiss(a, e)}
                  className="p-1 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors flex-shrink-0"
                  title="Dismiss — issue solved. If it happens again, a fresh alert will appear."
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default GlobalDefaultAlerts;
