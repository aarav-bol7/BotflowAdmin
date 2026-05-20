import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

// Hardcoded scaffolding — backend wiring will replace this later.
const DUMMY_NOTIFICATIONS = [
  { id: 'n1', title: 'New model available',  severity: 'info',
    message: 'gpt-5-pro is now available through the LiteLLM gateway.',
    timestamp: '2026-04-23T09:15:00Z' },
  { id: 'n2', title: 'Quota at 80%',          severity: 'warning',
    message: 'OpenAI monthly token budget is 80% consumed.',
    timestamp: '2026-04-23T08:42:00Z' },
  { id: 'n3', title: 'Rate limit hit',        severity: 'error',
    message: 'Anthropic returned 429 for 12 requests in the last 5 minutes.',
    timestamp: '2026-04-22T22:01:00Z' },
  { id: 'n4', title: 'Provider added',        severity: 'info',
    message: 'Together AI was added to the gateway routing table.',
    timestamp: '2026-04-22T17:30:00Z' },
  { id: 'n5', title: 'Latency degraded',      severity: 'warning',
    message: 'Gemini p95 latency is above 4s for the last hour.',
    timestamp: '2026-04-22T11:05:00Z' },
  { id: 'n6', title: 'Key rotated',           severity: 'info',
    message: 'Mistral API key was rotated by an admin.',
    timestamp: '2026-04-21T19:48:00Z' },
];

// Visual styles mirror Botflow_admin/src/pages/Notifications.jsx — keep in sync
// if that file's SEVERITY palette changes.
function severityIcon(severity) {
  switch (severity) {
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
    default:
      return <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
  }
}

function severityBg(severity) {
  switch (severity) {
    case 'error':   return 'bg-red-50 dark:bg-red-900/20 border-l-red-500';
    case 'warning': return 'bg-orange-50 dark:bg-orange-900/20 border-l-orange-500';
    default:        return 'bg-blue-50 dark:bg-blue-900/20 border-l-blue-500';
  }
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function NotificationsList() {
  return (
    <div className="space-y-3">
      {DUMMY_NOTIFICATIONS.map((n) => (
        <div
          key={n.id}
          className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 border-l-4 overflow-hidden transition-all duration-200 hover:shadow-lg ${severityBg(n.severity)}`}
        >
          <div className="p-4 flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">{severityIcon(n.severity)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-semibold text-slate-900 dark:text-white">{n.title}</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{n.message}</p>
              <span className="text-xs text-slate-500 dark:text-slate-500">
                {formatTimestamp(n.timestamp)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default NotificationsList;
