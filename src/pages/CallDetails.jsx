import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Loader2, Phone, ShieldAlert, ShieldOff, ShieldCheck, Bot, Calendar, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { callService } from '../api/callService';
import { botflowWs } from '../api/botflowWebSocket';
import { performReconnectCatchup } from '../api/reconnectCatchup';
import { getBotsByTenant as enumGetBotsByTenant } from '../api/enumerationService';

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  completed: { label: 'Completed', bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-800 dark:text-green-400' },
  failed:    { label: 'Failed',    bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-800 dark:text-red-400' },
  active:    { label: 'Active',    bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-800 dark:text-blue-400' },
  ringing:   { label: 'Ringing',   bg: 'bg-yellow-100 dark:bg-yellow-900/30',text: 'text-yellow-800 dark:text-yellow-400' },
};

const StatusBadge = ({ status }) => {
  const s = STATUS_STYLES[status] || { label: status, bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
};

// ─── Caller block badge ──────────────────────────────────────────────────────
const isPermanentBlock = (iso) => iso && new Date(iso).getFullYear() >= 2099;

const CallerBlockBadge = ({ blocks }) => {
  if (!blocks || blocks.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
        <ShieldCheck className="w-3 h-3" /> Active
      </span>
    );
  }
  const b = blocks[0];
  const label = isPermanentBlock(b.blockedUntil)
    ? 'Permanently Blocked'
    : `Blocked until ${new Date(b.blockedUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400" title={b.reason || ''}>
      <ShieldAlert className="w-3 h-3" /> {label}
    </span>
  );
};

// ─── Session block indicator ─────────────────────────────────────────────────
const SessionBlockBadge = ({ callerStatus, blockedUntil, blockReason }) => {
  if (callerStatus !== 'blocked') return null;
  const label = isPermanentBlock(blockedUntil) ? 'Permanently Blocked' : `Blocked until ${new Date(blockedUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400" title={blockReason || ''}>
      <ShieldAlert className="w-3 h-3" /> {label}
    </span>
  );
};

// ─── Block / Unblock modals ──────────────────────────────────────────────────
const DURATION_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '6 hours', value: 6 },
  { label: '24 hours', value: 24 },
  { label: '48 hours', value: 48 },
  { label: 'Permanent', value: 0 },
];

const BlockConfirmModal = ({ isOpen, caller, botKey, onConfirm, onClose, loading: isLoading }) => {
  const [duration, setDuration] = useState(24);
  const [reason, setReason] = useState('');
  // Reset state each time the modal opens for a (possibly different) caller
  useEffect(() => {
    if (isOpen) { setDuration(24); setReason(''); }
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full mx-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Block Caller</h3>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Block <span className="font-mono font-semibold text-slate-900 dark:text-white">{caller}</span> on bot <span className="font-semibold text-slate-900 dark:text-white">{botKey}</span>? Future calls from this number will be rejected.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">Duration</label>
            <div className="space-y-1.5">
              {DURATION_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="block-duration" value={opt.value} checked={duration === opt.value} onChange={() => setDuration(opt.value)}
                    className="w-4 h-4 text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{opt.label}</span>
                </label>
              ))}
            </div>
            {duration === 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Caller will be permanently blocked until manually unblocked.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 uppercase tracking-wider">Reason (optional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spam caller"
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
        </div>
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 rounded-b-xl">
          <button onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => onConfirm(duration, reason)} disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
            Block Caller
          </button>
        </div>
      </div>
    </div>
  );
};

const UnblockConfirmModal = ({ isOpen, caller, botKey, onConfirm, onClose, loading: isLoading }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full mx-4 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <ShieldOff className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Unblock Caller</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Unblock <span className="font-mono font-semibold text-slate-900 dark:text-white">{caller}</span> on bot <span className="font-semibold text-slate-900 dark:text-white">{botKey}</span>? This caller will be able to make calls again.
          </p>
        </div>
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 rounded-b-xl">
          <button onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
            Unblock Caller
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
};

const formatTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
};

const fmtNum = (n) => (n || 0).toLocaleString();

const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const timeAgo = (iso) => {
  if (!iso) return '—';
  const now = new Date();
  const date = new Date(iso);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
};

// ─── Date presets (matching ChatMessages.jsx pattern) ────────────────────────
const toLocalISO = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DATE_PRESETS = [
  { label: 'Last Hour',  offset: () => { const d = new Date(); d.setHours(d.getHours() - 1); return d; } },
  { label: 'Last Day',   offset: () => { const d = new Date(); d.setDate(d.getDate() - 1); return d; } },
  { label: 'Last Week',  offset: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d; } },
  { label: 'Last Month', offset: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; } },
  { label: 'Last Year',  offset: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; } },
];

const DateRangeFilter = ({ startDate, endDate, onStartChange, onEndChange, onApply, onClear }) => {
  const [presetVal, setPresetVal] = useState('');
  const handlePresetChange = (e) => {
    const idx = Number(e.target.value);
    if (isNaN(idx)) return;
    const preset = DATE_PRESETS[idx];
    const sd = toLocalISO(preset.offset());
    const ed = toLocalISO(new Date());
    onStartChange(sd);
    onEndChange(ed);
    onApply(sd, ed);
    setPresetVal('');
  };
  return (
    <div className="mb-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <Calendar className="w-4 h-4 text-slate-400 shrink-0 hidden sm:block" />
        <input type="datetime-local" value={startDate} onChange={(e) => onStartChange(e.target.value)}
          className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
        <span className="text-sm font-medium text-slate-400">to</span>
        <input type="datetime-local" value={endDate} onChange={(e) => onEndChange(e.target.value)}
          className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
        <select value={presetVal} onChange={handlePresetChange}
          className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
          <option value="" disabled>Quick select...</option>
          {DATE_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
        <button onClick={() => onApply()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">Apply</button>
        {(startDate || endDate) && (
          <button onClick={onClear} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" title="Clear date filter">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────
function CallDetails() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/bot-analytics') ? returnTo : '/bot-analytics';
  const initialTenantId = searchParams.get('tenantId') || searchParams.get('tenant_id') || '';
  const initialBotKey = searchParams.get('botKey') || searchParams.get('bot_key') || '';
  const urlAutoSelectRef = useRef(false);
  // View state machine: tenants → callers → detail
  const [view, setView] = useState('tenants');

  // Tenant list
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);

  // Callers view state
  const [callers, setCallers] = useState([]);
  const [selectedCaller, setSelectedCaller] = useState(null);
  const [expandedSession, setExpandedSession] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [botFilter, setBotFilter] = useState(initialBotKey);
  const [botList, setBotList] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [grandTotals, setGrandTotals] = useState({ calls: 0, pulses: 0, duration: 0 });
  const [globalSearchInput, setGlobalSearchInput] = useState('');

  // Shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [blockModal, setBlockModal] = useState({ isOpen: false, caller: '', botKey: '' });
  const [unblockModal, setUnblockModal] = useState({ isOpen: false, caller: '', botKey: '' });
  const [actionLoading, setActionLoading] = useState(false);

  // Global date filter (persists across views)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const PAGE_SIZE = 20;

  // Refs to avoid stale closures in WebSocket event handlers
  const startDateRef = useRef('');
  const endDateRef = useRef('');
  const statusFilterRef = useRef('');
  const botFilterRef = useRef(initialBotKey);
  const searchInputRef = useRef('');
  const globalSearchInputRef = useRef('');
  const viewRef = useRef('tenants');
  const selectedTenantRef = useRef(null);
  const pageRef = useRef(1);
  const wsConnectedRef = useRef(false);
  const pollingRef = useRef(null);
  const pollDelayRef = useRef(null);
  const statsDebounceRef = useRef(null);

  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);
  useEffect(() => { statusFilterRef.current = statusFilter; }, [statusFilter]);
  useEffect(() => { botFilterRef.current = botFilter; }, [botFilter]);
  useEffect(() => { searchInputRef.current = searchInput; }, [searchInput]);
  useEffect(() => { globalSearchInputRef.current = globalSearchInput; }, [globalSearchInput]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { selectedTenantRef.current = selectedTenant; }, [selectedTenant]);
  useEffect(() => { pageRef.current = page; }, [page]);

  // ─── Loaders ──────────────────────────────────────────────────────────────
  const loadTenants = (sd, ed) => {
    setLoading(true);
    setError(null);
    // Track E note: not migrated to enumerationService — the tenants-list
    // view renders per-tenant `sessionCount` + `botCount` that the unified
    // endpoint does not provide with matching field names. Migration would
    // require a JSX change (out of A-2-style minimum-diff scope).
    callService.getTenants({
      startDate: sd || startDateRef.current || '',
      endDate: ed || endDateRef.current || '',
    })
      .then((d) => setTenants(d.tenants || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadCallers = ({ search = '', status = '', botKey = botFilter, pg = 1, sd, ed } = {}) => {
    if (!selectedTenant) return;
    setLoading(true);
    setError(null);
    // Stale-closure fix: if handleDateApply passed fresh sd/ed, use them;
    // otherwise fall back to the committed startDate/endDate state.
    const effectiveSd = sd !== undefined ? sd : startDate;
    const effectiveEd = ed !== undefined ? ed : endDate;
    callService.getCallsGrouped({
      tenantId: selectedTenant.tenantId,
      botKey: botKey || '',
      startDate: effectiveSd || '',
      endDate: effectiveEd || '',
      search, status, page: pg, pageSize: PAGE_SIZE,
    })
      .then((data) => {
        setCallers(data.callers || []);
        setTotal(data.total || 0);
        setGrandTotals({
          calls: data.grandTotalCalls || 0,
          pulses: data.grandTotalPulses || 0,
          duration: data.grandTotalDuration || 0,
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadGlobalSearch = (search, { sd, ed } = {}) => {
    if (!search.trim()) return;
    setLoading(true);
    setError(null);
    // Stale-closure fix: honor explicit dates when passed by handleDateApply.
    const effectiveSd = sd !== undefined ? sd : startDate;
    const effectiveEd = ed !== undefined ? ed : endDate;
    callService.getCallsGrouped({
      search,
      startDate: effectiveSd || '',
      endDate: effectiveEd || '',
      page: 1, pageSize: PAGE_SIZE,
    })
      .then((data) => {
        setCallers(data.callers || []);
        setTotal(data.total || 0);
        setGrandTotals({
          calls: data.grandTotalCalls || 0,
          pulses: data.grandTotalPulses || 0,
          duration: data.grandTotalDuration || 0,
        });
        setPage(1);
        setView('search');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const handleGlobalSearch = () => {
    if (globalSearchInput.trim()) {
      loadGlobalSearch(globalSearchInput);
    }
  };

  const clearGlobalSearch = () => {
    setGlobalSearchInput('');
    setCallers([]);
    setView('tenants');
    loadTenants();
  };

  // Load tenants and global totals on mount
  useEffect(() => {
    loadTenants();
    callService.getCallsGrouped({
      startDate: startDateRef.current || '',
      endDate: endDateRef.current || '',
      page: 1, pageSize: 1,
    })
      .then((data) => setGrandTotals({
        calls: data.grandTotalCalls || 0,
        pulses: data.grandTotalPulses || 0,
        duration: data.grandTotalDuration || 0,
      }))
      .catch(() => {});
    // Flag URL pre-filter for auto-select after tenants load
    if (initialTenantId) {
      urlAutoSelectRef.current = initialTenantId;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select tenant from URL param after tenants load
  useEffect(() => {
    if (!urlAutoSelectRef.current || !tenants.length) return;
    const urlTid = urlAutoSelectRef.current;
    urlAutoSelectRef.current = null;
    const match = tenants.find(t => t.tenantId === urlTid);
    if (match) {
      selectTenant(match, { preserveBotFilter: true });
    } else {
      // Tenant exists but might not be in the list — use ID directly
      selectTenant({ tenantId: urlTid, tenantName: urlTid }, { preserveBotFilter: true });
    }
  }, [tenants]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Navigation ───────────────────────────────────────────────────────────
  const selectTenant = (tenant, { preserveBotFilter = false } = {}) => {
    setSelectedTenant(tenant);
    setSearchInput('');
    setStatusFilter('');
    if (!preserveBotFilter) setBotFilter('');
    setPage(1);
    setView('callers');
  };

  useEffect(() => {
    if (!selectedTenant) {
      setBotList([]);
      return;
    }
    enumGetBotsByTenant(selectedTenant.tenantId)
      .then((d) => setBotList(d.bots || []))
      .catch(() => setBotList([]));
  }, [selectedTenant]);

  // Load callers when entering callers view
  useEffect(() => {
    if (view === 'callers' && selectedTenant) {
      loadCallers({ search: searchInput, status: statusFilter, pg: 1 });
      setPage(1);
    }
  }, [view, selectedTenant]); // eslint-disable-line react-hooks/exhaustive-deps

  const [previousView, setPreviousView] = useState('tenants');

  const selectCaller = (caller) => {
    setPreviousView(view);  // remember where we came from
    setSelectedCaller(caller);
    setView('detail');
  };

  const goBackFromDetail = () => {
    setSelectedCaller(null);
    setExpandedSession(null);
    setView(previousView);
  };

  const jumpToTenants = () => {
    setSelectedCaller(null);
    setCallers([]);
    setSelectedTenant(null);
    setSearchInput('');
    setStatusFilter('');
    setBotFilter('');
    setBotList([]);
    setView('tenants');
    loadTenants();
  };



  // ─── Silent refetch: respects current view + filters via refs ────────────
  const silentRefetch = () => {
    const sd = startDateRef.current || '';
    const ed = endDateRef.current || '';
    const search = searchInputRef.current || '';
    const status = statusFilterRef.current || '';
    const botKey = botFilterRef.current || '';
    const tenantId = selectedTenantRef.current?.tenantId || '';
    const v = viewRef.current;

    // Always refresh grand totals with current filters
    callService.getCallsGrouped({
      tenantId: v === 'callers' ? tenantId : undefined,
      botKey: v === 'callers' ? botKey : undefined,
      startDate: sd,
      endDate: ed,
      search,
      status,
      page: 1,
      pageSize: 1,
    })
      .then((data) => setGrandTotals({
        calls: data.grandTotalCalls || 0,
        pulses: data.grandTotalPulses || 0,
        duration: data.grandTotalDuration || 0,
      })).catch(() => {});

    // Refresh current view
    if (v === 'tenants') {
      // Track E note: kept on legacy for legacy-field parity (see loadTenants).
      callService.getTenants({ startDate: sd, endDate: ed })
        .then((d) => setTenants(d.tenants || []))
        .catch(() => {});
    } else if (v === 'callers' && selectedTenantRef.current) {
      callService.getCallsGrouped({
        tenantId: selectedTenantRef.current.tenantId,
        botKey,
        startDate: sd, endDate: ed, search, status,
        page: pageRef.current, pageSize: PAGE_SIZE,
      }).then((data) => {
        setCallers(data.callers || []);
        setTotal(data.total || 0);
        const totalPages = Math.ceil((data.total || 0) / PAGE_SIZE);
        if (pageRef.current > totalPages && totalPages > 0) setPage(1);
      }).catch(() => {});
    } else if (v === 'search' && globalSearchInputRef.current) {
      callService.getCallsGrouped({
        search: globalSearchInputRef.current,
        startDate: sd, endDate: ed,
        page: pageRef.current, pageSize: PAGE_SIZE,
      }).then((data) => {
        setCallers(data.callers || []);
        setTotal(data.total || 0);
      }).catch(() => {});
    }
  };

  // ─── WebSocket: real-time block/unblock + stats + call events ───────────
  useEffect(() => {
    botflowWs.connect();

    // Debounced silent refetch for stats & call completion events
    const debouncedRefetch = () => {
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      statsDebounceRef.current = setTimeout(() => silentRefetch(), 2000);
    };

    const offConnected = botflowWs.on('connected', () => {
      wsConnectedRef.current = true;
      if (pollDelayRef.current) { clearTimeout(pollDelayRef.current); pollDelayRef.current = null; }
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    });

    const offDisconnected = botflowWs.on('disconnected', () => {
      wsConnectedRef.current = false;
      pollDelayRef.current = setTimeout(() => {
        if (!wsConnectedRef.current && !pollingRef.current) {
          pollingRef.current = setInterval(() => silentRefetch(), 15000);
        }
      }, 20000);
    });

    // Track B: reconnect catch-up. Query flat calls endpoint with since_ts;
    // if any rows returned, trigger a blind regroup refetch (grouped view
    // can't merge raw rows meaningfully). If zero rows, skip the refetch —
    // nothing happened during the gap, no bandwidth wasted.
    const offReconnected = botflowWs.on('reconnected', () => {
      wsConnectedRef.current = true;
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      const snapshot = {
        tenant_id: selectedTenantRef.current?.tenantId || undefined,
        bot_key: botFilterRef.current || undefined,
        status: statusFilterRef.current || undefined,
        search: globalSearchInputRef.current || searchInputRef.current || undefined,
      };
      performReconnectCatchup({
        wsClient: botflowWs,
        catchupFetch: callService.fetchCallsCatchup,
        fullRefetch: () => silentRefetch(),
        mergeFn: (items) => {
          if (items.length > 0) silentRefetch();
        },
        filters: snapshot,
      }).catch((err) => {
        console.warn('[CallDetails] catch-up failed:', err);
      });
    });

    const offStats = botflowWs.on('stats.updated', debouncedRefetch);
    const offCallCompleted = botflowWs.on('call.completed', debouncedRefetch);
    const offCallFailed = botflowWs.on('call.failed', debouncedRefetch);

    const offBlocked = botflowWs.on('caller.blocked', (payload) => {
      setCallers((prev) => prev.map((c) => {
        if (c.caller !== payload.caller || c.botKey !== payload.botKey) return c;
        const newBlock = { botKey: payload.botKey, blockedUntil: payload.blockedUntil, reason: payload.reason };
        return { ...c, blocks: [newBlock], sessions: c.sessions.map((s) =>
          s.botKey === payload.botKey ? { ...s, callerStatus: 'blocked', blockedUntil: payload.blockedUntil, blockReason: payload.reason } : s
        )};
      }));
      setSelectedCaller((prev) => {
        if (!prev || prev.caller !== payload.caller || prev.botKey !== payload.botKey) return prev;
        const newBlock = { botKey: payload.botKey, blockedUntil: payload.blockedUntil, reason: payload.reason };
        return { ...prev, blocks: [newBlock], sessions: prev.sessions.map((s) =>
          s.botKey === payload.botKey ? { ...s, callerStatus: 'blocked', blockedUntil: payload.blockedUntil, blockReason: payload.reason } : s
        )};
      });
    });

    const offUnblocked = botflowWs.on('caller.unblocked', (payload) => {
      setCallers((prev) => prev.map((c) => {
        if (c.caller !== payload.caller || c.botKey !== payload.botKey) return c;
        return { ...c, blocks: [], sessions: c.sessions.map((s) =>
          s.botKey === payload.botKey ? { ...s, callerStatus: 'active', blockedUntil: null, blockReason: '' } : s
        )};
      }));
      setSelectedCaller((prev) => {
        if (!prev || prev.caller !== payload.caller || prev.botKey !== payload.botKey) return prev;
        return { ...prev, blocks: [], sessions: prev.sessions.map((s) =>
          s.botKey === payload.botKey ? { ...s, callerStatus: 'active', blockedUntil: null, blockReason: '' } : s
        )};
      });
    });

    return () => {
      offConnected(); offDisconnected(); offReconnected();
      offStats(); offCallCompleted(); offCallFailed();
      offBlocked(); offUnblocked();
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      if (pollDelayRef.current) clearTimeout(pollDelayRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
      botflowWs.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Block / unblock handlers ─────────────────────────────────────────────
  const handleBlock = (caller, botKey) => setBlockModal({ isOpen: true, caller, botKey });
  const handleUnblock = (caller, botKey) => setUnblockModal({ isOpen: true, caller, botKey });

  const confirmBlock = async (durationHours, reason) => {
    setActionLoading(true);
    try {
      await callService.blockCaller(blockModal.caller, blockModal.botKey, durationHours, reason);
      toast.success(`Blocked ${blockModal.caller}`);
      // Update selectedCaller immediately so detail view button reflects the change
      const newBlock = { botKey: blockModal.botKey, blockedUntil: durationHours === 0 ? null : new Date(Date.now() + durationHours * 3600000).toISOString(), reason };
      setSelectedCaller((prev) => {
        if (!prev || prev.caller !== blockModal.caller) return prev;
        return { ...prev, blocks: [newBlock], sessions: (prev.sessions || []).map((s) =>
          s.botKey === blockModal.botKey ? { ...s, callerStatus: 'blocked' } : s
        )};
      });
      setBlockModal({ isOpen: false, caller: '', botKey: '' });
      loadCallers({ search: searchInput, status: statusFilter, pg: page });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const confirmUnblock = async () => {
    setActionLoading(true);
    try {
      await callService.unblockCaller(unblockModal.caller, unblockModal.botKey);
      toast.success(`Unblocked ${unblockModal.caller}`);
      // Update selectedCaller immediately so detail view button reflects the change
      setSelectedCaller((prev) => {
        if (!prev || prev.caller !== unblockModal.caller) return prev;
        return { ...prev, blocks: [], sessions: (prev.sessions || []).map((s) =>
          s.botKey === unblockModal.botKey ? { ...s, callerStatus: 'active', blockedUntil: null, blockReason: '' } : s
        )};
      });
      setUnblockModal({ isOpen: false, caller: '', botKey: '' });
      loadCallers({ search: searchInput, status: statusFilter, pg: page });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    loadCallers({ search: searchInput, status: statusFilter, botKey: botFilter, pg: 1 });
  };

  const handleStatusChange = (newStatus) => {
    setStatusFilter(newStatus);
    setPage(1);
    loadCallers({ search: searchInput, status: newStatus, botKey: botFilter, pg: 1 });
  };

  const handleBotFilterChange = (newBotKey) => {
    setBotFilter(newBotKey);
    setPage(1);
    loadCallers({ search: searchInput, status: statusFilter, botKey: newBotKey, pg: 1 });
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadCallers({ search: searchInput, status: statusFilter, botKey: botFilter, pg: newPage });
  };

  const handleDateApply = (sd, ed) => {
    const s = sd || startDate;
    const e = ed || endDate;
    if (sd) setStartDate(sd);
    if (ed) setEndDate(ed);
    // Explicitly refresh current view with new dates
    const v = view;
    if (v === 'tenants') {
      loadTenants(s, e);
      callService.getCallsGrouped({ startDate: s || '', endDate: e || '', page: 1, pageSize: 1 })
        .then((data) => setGrandTotals({
          calls: data.grandTotalCalls || 0,
          pulses: data.grandTotalPulses || 0,
          duration: data.grandTotalDuration || 0,
        })).catch(() => {});
    } else if (v === 'callers' && selectedTenant) {
      loadCallers({ search: searchInput, status: statusFilter, botKey: botFilter, pg: 1, sd: s, ed: e });
      setPage(1);
    } else if (v === 'search' && globalSearchInput) {
      loadGlobalSearch(globalSearchInput, { sd: s, ed: e });
    }
  };

  const handleDateClear = () => {
    setStartDate('');
    setEndDate('');
    // Explicitly refresh with cleared dates — pass '' through to avoid the
    // stale-closure race between setStartDate/setEndDate above and the
    // immediate fetch below.
    const v = view;
    if (v === 'tenants') {
      loadTenants('', '');
      callService.getCallsGrouped({ page: 1, pageSize: 1 })
        .then((data) => setGrandTotals({
          calls: data.grandTotalCalls || 0,
          pulses: data.grandTotalPulses || 0,
          duration: data.grandTotalDuration || 0,
        })).catch(() => {});
    } else if (v === 'callers' && selectedTenant) {
      loadCallers({ search: searchInput, status: statusFilter, botKey: botFilter, pg: 1, sd: '', ed: '' });
      setPage(1);
    } else if (v === 'search' && globalSearchInput) {
      loadGlobalSearch(globalSearchInput, { sd: '', ed: '' });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tableBodyClass = `divide-y divide-slate-200 dark:divide-slate-700 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`;

  const ErrorBanner = () => error ? (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {error}
    </div>
  ) : null;

  // ─── Breadcrumb ───────────────────────────────────────────────────────────
  const crumbLink = "text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer";
  const crumbCurrent = "text-slate-700 dark:text-slate-300";
  const crumbSep = "text-slate-400 mx-1";

  const Breadcrumb = () => (
    <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-center text-sm font-medium overflow-hidden whitespace-nowrap">
        {view === 'tenants' ? (
          <span className={crumbCurrent}>All Tenants</span>
        ) : (
          <button onClick={view === 'search' ? clearGlobalSearch : jumpToTenants} className={crumbLink}>All Tenants</button>
        )}
        {(view === 'search' || (view === 'detail' && previousView === 'search')) && (
          <>
            <span className={crumbSep}>&rsaquo;</span>
            {view === 'search' ? (
              <span className={crumbCurrent}>Search: &quot;{globalSearchInput}&quot;</span>
            ) : (
              <button onClick={goBackFromDetail} className={crumbLink}>Search: &quot;{globalSearchInput}&quot;</button>
            )}
          </>
        )}
        {selectedTenant && (view === 'callers' || (view === 'detail' && previousView === 'callers')) && (
          <>
            <span className={crumbSep}>&rsaquo;</span>
            {view === 'callers' ? (
              <span className={`${crumbCurrent} truncate`}>{selectedTenant.tenantName || selectedTenant.tenantId}</span>
            ) : (
              <button onClick={goBackFromDetail} className={`${crumbLink} truncate`}>{selectedTenant.tenantName || selectedTenant.tenantId}</button>
            )}
          </>
        )}
        {selectedCaller && view === 'detail' && (
          <>
            <span className={crumbSep}>&rsaquo;</span>
            <span className={`${crumbCurrent} truncate font-mono`}>{selectedCaller.caller || 'Unknown'}</span>
          </>
        )}
      </div>
      {returnTo && (
        <button
          type="button"
          onClick={() => navigate(safeReturnTo)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Bot Analytics
        </button>
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">WhatsApp Calls</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Voice call sessions grouped by caller.</p>
      </div>

      <Breadcrumb />
      <DateRangeFilter startDate={startDate} endDate={endDate}
        onStartChange={setStartDate} onEndChange={setEndDate}
        onApply={handleDateApply} onClear={handleDateClear} />
      {/* Stats tiles — always visible */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Calls</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtNum(grandTotals.calls)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Pulses</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtNum(grandTotals.pulses)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Call Duration</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatDuration(grandTotals.duration)}</div>
        </div>
      </div>

      <ErrorBanner />

      {/* ── Global search bar (shown on tenants view) ──────────────────────── */}
      {(view === 'tenants' || view === 'search') && (
        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={globalSearchInput}
              onChange={(e) => setGlobalSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGlobalSearch()}
              placeholder="Search caller across all tenants..."
              className="w-full pl-9 pr-9 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {globalSearchInput && (
              <button onClick={clearGlobalSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button onClick={handleGlobalSearch}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            Search
          </button>
        </div>
      )}

      {/* ── Search results view (cross-tenant) ─────────────────────────────── */}
      {view === 'search' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
          {loading && <div className="absolute top-2 right-3 z-10"><Loader2 className="w-4 h-4 animate-spin text-indigo-500" /></div>}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[15%]">CALLER</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[13%]">TENANT</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[10%]">BOT</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[9%]">STATUS</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[6%]">CALLS</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[6%]">FAILED</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[6%]">PULSES</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[9%]">DURATION</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[12%] whitespace-nowrap">LAST CALL</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[14%]">ACTION</th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {callers.length === 0 && !loading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No results found</td></tr>
                ) : callers.map((c, idx) => (
                  <tr key={`${c.caller}_${c.botKey}_${idx}`}
                    onClick={() => selectCaller(c)}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-slate-50/50 dark:bg-slate-800/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white truncate">{c.caller || 'Unknown Caller'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-900 dark:text-white truncate">{c.tenantName || '—'}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">{c.tenantId || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 truncate max-w-full">
                        <Bot className="w-3 h-3 shrink-0" /> {c.botName || c.botKey || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><CallerBlockBadge blocks={c.blocks || []} /></td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">{c.totalCalls}</td>
                    <td className="px-4 py-3 text-sm">
                      {c.totalFailed > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{c.totalFailed}</span> : <span className="text-slate-400">0</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{fmtNum(c.totalPulses)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{formatDuration(c.totalDuration)}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap" title={formatDate(c.lastCallAt)}>{timeAgo(c.lastCallAt)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {c.botKey ? (
                        (c.blocks || []).length > 0 ? (
                          <button onClick={() => handleUnblock(c.caller, c.botKey)} disabled={actionLoading}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors">
                            <ShieldOff className="w-3.5 h-3.5" /> Unblock
                          </button>
                        ) : (
                          <button onClick={() => handleBlock(c.caller, c.botKey)} disabled={actionLoading}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors">
                            <ShieldAlert className="w-3.5 h-3.5" /> Block
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-400">{total} result{total !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}

      {/* ── Tenants view ────────────────────────────────────────────────────── */}
      {view === 'tenants' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
          {loading && <div className="absolute top-2 right-3 z-10"><Loader2 className="w-4 h-4 animate-spin text-indigo-500" /></div>}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[50%]">TENANT</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[25%]">BOTS</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[25%]">SESSIONS</th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {tenants.length === 0 && !loading ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No tenants found</td></tr>
                ) : tenants.map((t, idx) => (
                  <tr key={t.tenantId} onClick={() => selectTenant(t)}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-slate-50/50 dark:bg-slate-800/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{t.tenantName || '—'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{t.tenantId}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{t.botCount || 0}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{fmtNum(t.sessionCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Callers view ────────────────────────────────────────────────────── */}
      {view === 'callers' && (
        <>
          {/* Search + Status filter */}
          <div className="mb-4 flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by caller or call ID..."
                className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
            </div>
            <button onClick={handleSearch}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
              Search
            </button>
            <select value={statusFilter} onChange={(e) => handleStatusChange(e.target.value)}
              className="px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="active">Active</option>
              <option value="ringing">Ringing</option>
            </select>
            <select value={botFilter} onChange={(e) => handleBotFilterChange(e.target.value)}
              className="px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
              <option value="">All bots</option>
              {botFilter && !botList.some(b => b.botKey === botFilter) && (
                <option value={botFilter}>{botFilter}</option>
              )}
              {botList.map((b) => (
                <option key={b.botKey} value={b.botKey}>{b.botName || b.botKey}</option>
              ))}
            </select>
          </div>

          {/* Caller table */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
            {loading && <div className="absolute top-2 right-3 z-10"><Loader2 className="w-4 h-4 animate-spin text-indigo-500" /></div>}
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[18%]">CALLER</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[12%]">BOT</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[10%]">STATUS</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[7%]">CALLS</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[7%]">FAILED</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[7%]">PULSES</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[10%]">DURATION</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[14%] whitespace-nowrap">LAST CALL</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider w-[15%]">ACTION</th>
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>
                  {callers.length === 0 && !loading ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No callers found</td></tr>
                  ) : callers.map((c, idx) => (
                    <tr key={`${c.caller}_${c.botKey}_${idx}`}
                      onClick={() => selectCaller(c)}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors ${idx % 2 === 1 ? 'bg-slate-50/50 dark:bg-slate-800/20' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white truncate">{c.caller || 'Unknown Caller'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 truncate max-w-full">
                          <Bot className="w-3 h-3 shrink-0" />
                          {c.botName || c.botKey || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3"><CallerBlockBadge blocks={c.blocks || []} /></td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">{c.totalCalls}</td>
                      <td className="px-4 py-3 text-sm">
                        {c.totalFailed > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{c.totalFailed}</span> : <span className="text-slate-400">0</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{fmtNum(c.totalPulses)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{formatDuration(c.totalDuration)}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap" title={formatDate(c.lastCallAt)}>{timeAgo(c.lastCallAt)}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {c.botKey ? (
                          (c.blocks || []).length > 0 ? (
                            <button onClick={() => handleUnblock(c.caller, c.botKey)} disabled={actionLoading}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors">
                              <ShieldOff className="w-3.5 h-3.5" /> Unblock
                            </button>
                          ) : (
                            <button onClick={() => handleBlock(c.caller, c.botKey)} disabled={actionLoading}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors">
                              <ShieldAlert className="w-3.5 h-3.5" /> Block
                            </button>
                          )
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <p className="text-sm text-slate-600 dark:text-slate-400">Page {page} of {totalPages} ({total} caller{total !== 1 ? 's' : ''})</p>
              <div className="flex gap-2">
                <button onClick={() => handlePageChange(page - 1)} disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </button>
                <button onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Detail view (caller sessions + transcripts) ─────────────────────── */}
      {view === 'detail' && selectedCaller && (
        <>
          <div className="mb-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
            <div className="flex items-center gap-3 mb-3">
              <Phone className="w-5 h-5 text-slate-400" />
              <span className="text-lg font-mono font-bold text-slate-900 dark:text-white">{selectedCaller.caller || 'Unknown Caller'}</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">
                <Bot className="w-3 h-3" /> {selectedCaller.botName || selectedCaller.botKey || '—'}
              </span>
              <CallerBlockBadge blocks={selectedCaller.blocks || []} />
              {(selectedCaller.blocks || []).length > 0 ? (
                <button onClick={() => handleUnblock(selectedCaller.caller, selectedCaller.botKey)}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                  <ShieldCheck className="w-3.5 h-3.5" /> Unblock
                </button>
              ) : (
                <button onClick={() => handleBlock(selectedCaller.caller, selectedCaller.botKey)}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
                  <ShieldAlert className="w-3.5 h-3.5" /> Block
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-500 dark:text-slate-400">
              <span>{selectedCaller.totalCalls} call{selectedCaller.totalCalls !== 1 ? 's' : ''}</span>
              <span>{fmtNum(selectedCaller.totalPulses)} pulses</span>
              <span>{formatDuration(selectedCaller.totalDuration)}</span>
              <span>Last call: {formatDate(selectedCaller.lastCallAt)}</span>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-400 dark:text-slate-500 mt-2">
              <span>Completion: {selectedCaller.sessions?.length ? Math.round((selectedCaller.sessions.filter(s => s.status === 'completed').length / selectedCaller.sessions.length) * 100) : 0}%</span>
              <span>Avg duration: {formatDuration(selectedCaller.totalDuration / Math.max(selectedCaller.totalCalls || 1, 1))}</span>
            </div>
          </div>

          <div className="space-y-3">
            {selectedCaller.sessions?.map((sess) => (
              <div key={sess.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden">
                {/* Clickable session header */}
                <div
                  onClick={() => setExpandedSession(expandedSession === sess.id ? null : sess.id)}
                  className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 flex flex-wrap items-center gap-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${expandedSession === sess.id ? 'rotate-180' : ''}`} />
                  <StatusBadge status={sess.status} />
                  <SessionBlockBadge callerStatus={sess.callerStatus} blockedUntil={sess.blockedUntil} blockReason={sess.blockReason} />
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{formatDate(sess.startedAt)}</span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">{sess.durationDisplay || '—'}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{sess.pulseCount} pulse{sess.pulseCount !== 1 ? 's' : ''}</span>
                  {sess.messages?.length > 0 && (
                    <span className="text-xs text-slate-400">{sess.messages.length} msg{sess.messages.length !== 1 ? 's' : ''}</span>
                  )}
                  {sess.errorMessage && <span className="text-xs text-red-500 dark:text-red-400">{sess.errorMessage}</span>}
                </div>

                {/* Collapsible transcript */}
                {expandedSession === sess.id && (
                  <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                    {(!sess.messages || sess.messages.length === 0) ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No transcript available.</p>
                    ) : (
                      <div className="space-y-3">
                        {sess.messages.map((m, i) => {
                          const isUser = m.role === 'user';
                          return (
                            <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                                isUser
                                  ? 'bg-indigo-600 text-white rounded-br-sm'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-bl-sm'
                              }`}>
                                <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                                <p className={`text-xs mt-1 ${isUser ? 'text-indigo-200 text-right' : 'text-slate-400'}`}>{formatTime(m.createdAt)}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Block / Unblock modals */}
      <BlockConfirmModal isOpen={blockModal.isOpen} caller={blockModal.caller} botKey={blockModal.botKey}
        onConfirm={confirmBlock} onClose={() => setBlockModal({ isOpen: false, caller: '', botKey: '' })} loading={actionLoading} />
      <UnblockConfirmModal isOpen={unblockModal.isOpen} caller={unblockModal.caller} botKey={unblockModal.botKey}
        onConfirm={confirmUnblock} onClose={() => setUnblockModal({ isOpen: false, caller: '', botKey: '' })} loading={actionLoading} />
    </div>
  );
}

export default CallDetails;
