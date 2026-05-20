import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, ChevronLeft, ChevronRight, AlertTriangle, Loader2, MessageSquare, Calendar, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { chatService } from '../api/chatService';
import { botflowWs } from '../api/botflowWebSocket';
import { mergeById, performReconnectCatchup } from '../api/reconnectCatchup';
import { getBotsByTenant as enumGetBotsByTenant } from '../api/enumerationService';

// ─── Channel badge ────────────────────────────────────────────────────────────
const CHANNEL_STYLES = {
  whatsapp:       { label: 'WhatsApp',  bg: 'bg-green-100 dark:bg-green-900/30',    text: 'text-green-800 dark:text-green-400' },
  telegram:       { label: 'Telegram',  bg: 'bg-blue-100 dark:bg-blue-900/30',      text: 'text-blue-800 dark:text-blue-400' },
  facebook:       { label: 'Facebook',  bg: 'bg-blue-200 dark:bg-blue-900/40',      text: 'text-blue-900 dark:text-blue-300' },
  instagram:      { label: 'Instagram', bg: 'bg-pink-100 dark:bg-pink-900/30',      text: 'text-pink-800 dark:text-pink-400' },
  webhook:        { label: 'Webhook',   bg: 'bg-slate-100 dark:bg-slate-800',       text: 'text-slate-700 dark:text-slate-300' },
  email:          { label: 'Email',     bg: 'bg-indigo-100 dark:bg-indigo-900/30',  text: 'text-indigo-800 dark:text-indigo-400' },
  rcs:            { label: 'RCS',       bg: 'bg-orange-100 dark:bg-orange-900/30',  text: 'text-orange-800 dark:text-orange-400' },
  whatsapp_voice: { label: 'Voice',     bg: 'bg-emerald-100 dark:bg-emerald-900/30',text: 'text-emerald-800 dark:text-emerald-400' },
};

const ChannelBadge = ({ channel }) => {
  const s = CHANNEL_STYLES[channel] || CHANNEL_STYLES.webhook;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
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

const fmtTokens = (n) => (n || 0).toLocaleString();

// ─── Date presets ─────────────────────────────────────────────────────────────
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

// ─── Date Range Filter ────────────────────────────────────────────────────────
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
        <input
          type="datetime-local"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <span className="text-sm font-medium text-slate-400">to</span>
        <input
          type="datetime-local"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <select
          value={presetVal}
          onChange={handlePresetChange}
          className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        >
          <option value="" disabled>Quick select...</option>
          {DATE_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
          ))}
        </select>
        <button
          onClick={() => onApply()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Apply
        </button>
        {(startDate || endDate) && (
          <button
            onClick={onClear}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            title="Clear date filter"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Token Display ────────────────────────────────────────────────────────────
const TokenBadge = ({ total }) => (
  <div className="text-sm font-medium text-slate-900 dark:text-white">{fmtTokens(total)}</div>
);

// ─── Component ────────────────────────────────────────────────────────────────
function ChatMessages() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/bot-analytics') ? returnTo : '/bot-analytics';
  // view state machine: tenants → bots → sessions → chat
  const [view, setView] = useState('tenants');

  const [tenants, setTenants] = useState([]);
  const [grandTotals, setGrandTotals] = useState({ total: 0, sessions: 0, messages: 0 });
  const [bots, setBots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionsTotals, setSessionsTotals] = useState({ prompt: 0, completion: 0, total: 0 });
  const [messages, setMessages] = useState(null);

  const [selectedTenant, setSelectedTenant] = useState(null);
  const [selectedBot, setSelectedBot] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);

  const [availableChannels, setAvailableChannels] = useState([]);
  const [channelFilter, setChannelFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;

  // Global date filter (persists across all views)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Refs to avoid stale closures in WebSocket event handlers
  const wsConnectedRef = useRef(false);
  const pollingRef = useRef(null);
  const pollDelayRef = useRef(null);
  const statsDebounceRef = useRef(null);
  const startDateRef = useRef('');
  const endDateRef = useRef('');
  const viewRef = useRef('tenants');
  const selectedTenantRef = useRef(null);
  const selectedBotRef = useRef(null);
  const selectedSessionRef = useRef(null);
  const channelFilterRef = useRef('');
  const searchInputRef = useRef('');
  const pageRef = useRef(1);

  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { selectedTenantRef.current = selectedTenant; }, [selectedTenant]);
  useEffect(() => { selectedBotRef.current = selectedBot; }, [selectedBot]);
  useEffect(() => { selectedSessionRef.current = selectedSession; }, [selectedSession]);
  useEffect(() => { channelFilterRef.current = channelFilter; }, [channelFilter]);
  useEffect(() => { searchInputRef.current = searchInput; }, [searchInput]);
  useEffect(() => { pageRef.current = page; }, [page]);
  // Track B: snapshot refs for reconnect catch-up merge callbacks.
  const sessionsRef = useRef([]);
  const messagesRef = useRef(null);
  const catchupAbortRef = useRef(null);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Build date params object, with optional overrides for clear scenario
  const buildDateParams = (sd, ed) => {
    const p = {};
    if (sd) p.startDate = sd;
    if (ed) p.endDate = ed;
    return p;
  };

  // ─── Loaders (accept optional date overrides to avoid stale closures) ───────
  const loadTenants = (sd = startDate, ed = endDate) => {
    setLoading(true);
    setError(null);
    chatService.getTenants(buildDateParams(sd, ed))
      .then((data) => {
        setTenants(data.tenants || []);
        setGrandTotals({
          total: data.grandTotalTokens || 0,
          sessions: data.grandTotalSessions || 0,
          messages: data.grandTotalMessages || 0,
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadBots = (tenantId, sd = startDate, ed = endDate) => {
    setLoading(true);
    setError(null);
    // Track E: cached via enumerationService (shared backend helper → same shape).
    enumGetBotsByTenant(tenantId, buildDateParams(sd, ed))
      .then((data) => setBots(data.bots || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadSessions = (tenantId, botKey, { channel = '', search = '', pg = 1, sd = startDate, ed = endDate } = {}) => {
    setLoading(true);
    setError(null);
    chatService.getSessions(tenantId, botKey, { channel, search, page: pg, pageSize: PAGE_SIZE, ...buildDateParams(sd, ed) })
      .then((data) => {
        setSessions(data.sessions || []);
        setTotal(data.total || 0);
        setAvailableChannels([...new Set(data.channels || [])]);
        setSessionsTotals({
          prompt: data.totalPromptTokens || 0,
          completion: data.totalCompletionTokens || 0,
          total: data.totalTokens || 0,
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const loadMessages = (sessionId, type, sd = startDate, ed = endDate) => {
    setLoading(true);
    setError(null);
    chatService.getSessionMessages(sessionId, type, buildDateParams(sd, ed))
      .then((data) => setMessages(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  // ─── Mount (with optional URL pre-filtering from Bot Analytics) ─────────────
  useEffect(() => {
    const urlTenant = searchParams.get('tenantId');
    const urlBot = searchParams.get('botKey');
    if (urlTenant && urlBot) {
      // Jump straight to sessions view for the specified bot
      loadTenants(); // background: populates tenant list for breadcrumb back-nav
      enumGetBotsByTenant(urlTenant).then(d => {
        const loadedBots = d.bots || [];
        setBots(loadedBots);
        const matchedBot = loadedBots.find(b => b.botKey === urlBot);
        if (matchedBot) setSelectedBot(matchedBot);
      }).catch(() => {}); // silent bots load for back-nav (Track E cached)
      setSelectedTenant({ tenantId: urlTenant, tenantName: urlTenant });
      setSelectedBot({ botKey: urlBot, botName: urlBot });
      setView('sessions');
      loadSessions(urlTenant, urlBot);
    } else if (urlTenant) {
      // Jump to bots view for the specified tenant
      loadTenants();
      setSelectedTenant({ tenantId: urlTenant, tenantName: urlTenant });
      setView('bots');
      loadBots(urlTenant);
    } else {
      loadTenants();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Channel filter effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (view === 'sessions' && selectedTenant && selectedBot) {
      setPage(1);
      loadSessions(selectedTenant.tenantId, selectedBot.botKey, {
        channel: channelFilter,
        search: searchInput,
        pg: 1,
      });
    }
  }, [channelFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Date filter apply (accepts optional overrides for preset buttons) ─────
  const applyDateFilter = (sd, ed) => {
    const s = sd !== undefined ? sd : startDate;
    const e = ed !== undefined ? ed : endDate;
    if (view === 'tenants') loadTenants(s, e);
    else if (view === 'bots' && selectedTenant) loadBots(selectedTenant.tenantId, s, e);
    else if (view === 'sessions' && selectedTenant && selectedBot) {
      setPage(1);
      loadSessions(selectedTenant.tenantId, selectedBot.botKey, {
        channel: channelFilter, search: searchInput, pg: 1, sd: s, ed: e,
      });
    } else if (view === 'chat' && selectedSession) {
      loadMessages(selectedSession.sessionId, selectedSession.sessionType, s, e);
    }
  };

  const clearDateFilter = () => {
    setStartDate('');
    setEndDate('');
    // Pass empty dates directly to avoid stale closure issues
    if (view === 'tenants') loadTenants('', '');
    else if (view === 'bots' && selectedTenant) loadBots(selectedTenant.tenantId, '', '');
    else if (view === 'sessions' && selectedTenant && selectedBot) {
      setPage(1);
      loadSessions(selectedTenant.tenantId, selectedBot.botKey, {
        channel: channelFilter, search: searchInput, pg: 1, sd: '', ed: '',
      });
    } else if (view === 'chat' && selectedSession) {
      loadMessages(selectedSession.sessionId, selectedSession.sessionType, '', '');
    }
  };

  // ─── WebSocket: silent refetch (no loading spinner) ─────────────────────────
  const silentRefetch = () => {
    const dp = buildDateParams(startDateRef.current, endDateRef.current);
    const v = viewRef.current;

    if (v === 'tenants') {
      chatService.getTenants(dp)
        .then((data) => {
          setTenants(data.tenants || []);
          setGrandTotals({
            total: data.grandTotalTokens || 0,
            sessions: data.grandTotalSessions || 0,
            messages: data.grandTotalMessages || 0,
          });
        }).catch(() => {});
    } else if (v === 'bots' && selectedTenantRef.current) {
      enumGetBotsByTenant(selectedTenantRef.current.tenantId, dp)
        .then((data) => setBots(data.bots || []))
        .catch(() => {});
    } else if (v === 'sessions' && selectedTenantRef.current && selectedBotRef.current) {
      chatService.getSessions(selectedTenantRef.current.tenantId, selectedBotRef.current.botKey, {
        channel: channelFilterRef.current,
        search: searchInputRef.current,
        page: pageRef.current,
        pageSize: PAGE_SIZE,
        ...dp,
      }).then((data) => {
          setSessions(data.sessions || []);
          setTotal(data.total || 0);
          setAvailableChannels([...new Set(data.channels || [])]);
          setSessionsTotals({
            prompt: data.totalPromptTokens || 0,
            completion: data.totalCompletionTokens || 0,
            total: data.totalTokens || 0,
          });
          const totalPages = Math.ceil((data.total || 0) / PAGE_SIZE);
          if (pageRef.current > totalPages && totalPages > 0) setPage(1);
        }).catch(() => {});
    } else if (v === 'chat' && selectedSessionRef.current) {
      chatService.getSessionMessages(selectedSessionRef.current.sessionId, selectedSessionRef.current.sessionType, dp)
        .then((data) => setMessages(data))
        .catch(() => {});
    }
  };

  useEffect(() => {
    botflowWs.connect();

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

    // Track B: reconnect catch-up. View-level dispatch — aggregated views
    // (tenants/bots) use blind silentRefetch; sessions/chat views use since_ts
    // catch-up with id-based merge. A fresh AbortController is tied to each
    // reconnect so a view switch mid-catch-up cancels the stale request.
    const offReconnected = botflowWs.on('reconnected', () => {
      wsConnectedRef.current = true;
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }

      const v = viewRef.current;
      if (v === 'tenants' || v === 'bots') {
        silentRefetch();
        return;
      }

      // Cancel any pending catch-up from a previous reconnect cycle.
      if (catchupAbortRef.current) catchupAbortRef.current.abort();
      catchupAbortRef.current = new AbortController();
      const signal = catchupAbortRef.current.signal;

      if (v === 'sessions' && selectedTenantRef.current && selectedBotRef.current) {
        performReconnectCatchup({
          wsClient: botflowWs,
          catchupFetch: (filters, s) =>
            chatService.getSessionsCatchup(
              selectedTenantRef.current.tenantId,
              selectedBotRef.current.botKey,
              filters,
              s,
            ),
          fullRefetch: () => silentRefetch(),
          mergeFn: (items) => {
            const { merged, addedCount } = mergeById(sessionsRef.current, items, s => s.sessionId);
            if (addedCount > 0) setSessions(merged);
          },
          filters: {
            channel: channelFilterRef.current || undefined,
            search: searchInputRef.current || undefined,
          },
          abortSignal: signal,
        }).catch((err) => console.warn('[ChatMessages] sessions catch-up failed:', err));
      } else if (v === 'chat' && selectedSessionRef.current) {
        const session = selectedSessionRef.current;
        performReconnectCatchup({
          wsClient: botflowWs,
          catchupFetch: (filters, s) =>
            chatService.getSessionMessagesCatchup(
              session.sessionId,
              session.sessionType,
              filters.since_ts,
              s,
            ),
          fullRefetch: () => silentRefetch(),
          mergeFn: (items) => {
            if (items.length === 0) return;
            const current = messagesRef.current;
            // Messages endpoint returns `{messages: [...]}` on blind fetch,
            // but catch-up envelope returns plain items array of messages.
            const currentList = Array.isArray(current?.messages) ? current.messages : [];
            const keyFn = m => `${m.createdAt}|${m.role}|${m.content}`;
            const { merged, addedCount } = mergeById(currentList, items, keyFn);
            if (addedCount > 0) {
              // Append chronologically (existing are already sorted asc).
              const appended = [...currentList, ...merged.slice(0, addedCount)];
              appended.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
              setMessages({ ...(current || {}), messages: appended });
            }
          },
          filters: {},
          abortSignal: signal,
        }).then((result) => {
          if (result && result.status === 'error' && result.error?.status === 404) {
            toast.error('Session no longer exists');
            setMessages(null);
            setSelectedSession(null);
            setView('sessions');
          }
        }).catch((err) => console.warn('[ChatMessages] messages catch-up failed:', err));
      }
    });

    const offStats = botflowWs.on('stats.updated', debouncedRefetch);

    return () => {
      offConnected(); offDisconnected(); offReconnected(); offStats();
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      if (pollDelayRef.current) clearTimeout(pollDelayRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (catchupAbortRef.current) { catchupAbortRef.current.abort(); catchupAbortRef.current = null; }
      botflowWs.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Navigation ─────────────────────────────────────────────────────────────
  const selectTenant = (tenant) => {
    setSelectedTenant(tenant);
    setView('bots');
    loadBots(tenant.tenantId);
  };

  const selectBot = (bot) => {
    setSelectedBot(bot);
    setChannelFilter('');
    setSearchInput('');
    setPage(1);
    setView('sessions');
    loadSessions(selectedTenant.tenantId, bot.botKey);
  };

  const selectSession = (session) => {
    setSelectedSession(session);
    setView('chat');
    loadMessages(session.sessionId, session.sessionType);
  };

  // Jump functions for breadcrumb (clear all deeper state)
  const jumpToTenants = () => {
    setMessages(null);
    setSelectedSession(null);
    setSessions([]);
    setSessionsTotals({ prompt: 0, completion: 0, total: 0 });
    setSelectedBot(null);
    setChannelFilter('');
    setSearchInput('');
    setPage(1);
    setAvailableChannels([]);
    setBots([]);
    setSelectedTenant(null);
    setView('tenants');
  };

  const jumpToBots = () => {
    setMessages(null);
    setSelectedSession(null);
    setSessions([]);
    setSessionsTotals({ prompt: 0, completion: 0, total: 0 });
    setSelectedBot(null);
    setChannelFilter('');
    setSearchInput('');
    setPage(1);
    setAvailableChannels([]);
    setView('bots');
  };

  const jumpToSessions = () => {
    setMessages(null);
    setSelectedSession(null);
    setView('sessions');
  };

  const handleSearch = () => {
    if (!selectedTenant || !selectedBot) return;
    setPage(1);
    loadSessions(selectedTenant.tenantId, selectedBot.botKey, {
      channel: channelFilter,
      search: searchInput,
      pg: 1,
    });
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadSessions(selectedTenant.tenantId, selectedBot.botKey, {
      channel: channelFilter,
      search: searchInput,
      pg: newPage,
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─── Breadcrumb ─────────────────────────────────────────────────────────────
  const crumbLink = "text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer";
  const crumbCurrent = "text-slate-700 dark:text-slate-300";
  const crumbSep = "text-slate-400 mx-1";

  const Breadcrumb = () => (
    <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-center text-sm font-medium overflow-hidden whitespace-nowrap">
        {view === 'tenants' ? (
          <span className={crumbCurrent}>All Tenants</span>
        ) : (
          <button onClick={jumpToTenants} className={crumbLink}>All Tenants</button>
        )}
        {selectedTenant && view !== 'tenants' && (
          <>
            <span className={crumbSep}>&rsaquo;</span>
            {view === 'bots' ? (
              <span className={`${crumbCurrent} truncate`}>{selectedTenant.tenantName || selectedTenant.tenantId}</span>
            ) : (
              <button onClick={jumpToBots} className={`${crumbLink} truncate`}>{selectedTenant.tenantName || selectedTenant.tenantId}</button>
            )}
          </>
        )}
        {selectedBot && (view === 'sessions' || view === 'chat') && (
          <>
            <span className={crumbSep}>&rsaquo;</span>
            {view === 'sessions' ? (
              <span className={`${crumbCurrent} truncate`}>{selectedBot.botName || selectedBot.botKey}</span>
            ) : (
              <button onClick={jumpToSessions} className={`${crumbLink} truncate`}>{selectedBot.botName || selectedBot.botKey}</button>
            )}
          </>
        )}
        {selectedSession && view === 'chat' && (
          <>
            <span className={crumbSep}>&rsaquo;</span>
            <span className={`${crumbCurrent} truncate`}>{selectedSession.userId}</span>
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

  // ─── Shared UI fragments ─────────────────────────────────────────────────────
  const dateFilterProps = {
    startDate, endDate,
    onStartChange: setStartDate,
    onEndChange: setEndDate,
    onApply: applyDateFilter,
    onClear: clearDateFilter,
  };

  const ErrorBanner = () => error ? (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {error}
    </div>
  ) : null;


  const thClass = "px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider";

  // Fade class for tables during loading — keeps layout stable, just dims content
  const tableBodyClass = `divide-y divide-slate-200 dark:divide-slate-700 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`;

  // Reusable total token banner
  const StatsTile = ({ label, value }) => (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );

  // ─── View: Tenants ────────────────────────────────────────────────────────────
  if (view === 'tenants') {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <Breadcrumb />
        <DateRangeFilter {...dateFilterProps} />

        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatsTile label="Sessions" value={fmtTokens(grandTotals.sessions)} />
          <StatsTile label="Messages" value={fmtTokens(grandTotals.messages)} />
          <StatsTile label="Tokens" value={fmtTokens(grandTotals.total)} />
        </div>

        <ErrorBanner />
        {!loading && tenants.length === 0 && !error && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No tenants found.</p>
        )}

        {/* Desktop table */}
        <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
          {loading && (
            <div className="absolute top-2 right-3 z-10">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className={`${thClass} w-[40%]`}>TENANT</th>
                  <th className={`${thClass} w-[12%]`}>BOTS</th>
                  <th className={`${thClass} w-[15%]`}>SESSIONS</th>
                  <th className={`${thClass} w-[33%]`}>TOTAL TOKENS</th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {tenants.length === 0 && !loading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No tenants found</td></tr>
                ) : tenants.map((t) => (
                  <tr
                    key={t.tenantId}
                    onClick={() => selectTenant(t)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      {t.tenantName ? (
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{t.tenantName}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{t.tenantId}</div>
                        </div>
                      ) : (
                        <span className="text-sm font-mono text-slate-900 dark:text-white truncate block">{t.tenantId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{t.botCount}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{t.sessionCount}</td>
                    <td className="px-4 py-3"><TokenBadge total={t.totalTokens} prompt={t.promptTokens} completion={t.completionTokens} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile */}
        <div className={`lg:hidden space-y-3 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
          {tenants.map((t) => (
            <div
              key={t.tenantId}
              onClick={() => selectTenant(t)}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 cursor-pointer hover:shadow-lg transition-all"
            >
              {t.tenantName && <p className="text-sm font-medium text-slate-900 dark:text-white mb-0.5">{t.tenantName}</p>}
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mb-2">{t.tenantId}</p>
              <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>{t.botCount} bots</span>
                <span>{t.sessionCount} sessions</span>
                <span>{fmtTokens(t.totalTokens)} tokens</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── View: Bots ───────────────────────────────────────────────────────────────
  if (view === 'bots') {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <Breadcrumb />
        <DateRangeFilter {...dateFilterProps} />

        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatsTile label="Sessions" value={fmtTokens(bots.reduce((s, b) => s + (b.sessionCount || 0), 0))} />
          <StatsTile label="Bots" value={fmtTokens(bots.length)} />
          <StatsTile label="Tokens" value={fmtTokens(bots.reduce((s, b) => s + (b.totalTokens || 0), 0))} />
        </div>

        <ErrorBanner />

        <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
          {loading && (
            <div className="absolute top-2 right-3 z-10">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className={`${thClass} w-[30%]`}>BOT KEY</th>
                  <th className={`${thClass} w-[30%]`}>NAME</th>
                  <th className={`${thClass} w-[15%]`}>SESSIONS</th>
                  <th className={`${thClass} w-[25%]`}>TOTAL TOKENS</th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {bots.length === 0 && !loading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No bots found</td></tr>
                ) : bots.map((b) => (
                  <tr
                    key={b.botKey}
                    onClick={() => selectBot(b)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-slate-900 dark:text-white truncate">{b.botKey}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 truncate">{b.botName}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{b.sessionCount}</td>
                    <td className="px-4 py-3"><TokenBadge total={b.totalTokens} prompt={b.promptTokens} completion={b.completionTokens} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile */}
        <div className={`lg:hidden space-y-3 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
          {bots.map((b) => (
            <div
              key={b.botKey}
              onClick={() => selectBot(b)}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 cursor-pointer hover:shadow-lg transition-all"
            >
              <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{b.botName}</p>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">{b.botKey}</p>
              <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>{b.sessionCount} sessions</span>
                <span>{fmtTokens(b.totalTokens)} tokens</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── View: Sessions ───────────────────────────────────────────────────────────
  if (view === 'sessions') {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <Breadcrumb />
        <DateRangeFilter {...dateFilterProps} />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <StatsTile label="Sessions" value={fmtTokens(total)} />
          <StatsTile label="Tokens" value={fmtTokens(sessionsTotals.total)} />
        </div>

        <ErrorBanner />

        {/* Search + channel filter */}
        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search by user ID..."
              className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            Search
          </button>
          {availableChannels.length > 0 && (
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">All channels</option>
              {availableChannels.map((ch) => (
                <option key={ch} value={ch}>
                  {CHANNEL_STYLES[ch]?.label ?? ch}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
          {loading && (
            <div className="absolute top-2 right-3 z-10">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className={`${thClass} w-[12%]`}>CHANNEL</th>
                  <th className={`${thClass} w-[22%]`}>USER ID</th>
                  <th className={`${thClass} w-[26%]`}>LAST MESSAGE</th>
                  <th className={`${thClass} w-[20%]`}>TOTAL TOKENS</th>
                  <th className={`${thClass} w-[20%]`}>LAST ACTIVE</th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {sessions.length === 0 && !loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No sessions found</td></tr>
                ) : sessions.map((s) => (
                  <tr
                    key={s.sessionId}
                    onClick={() => selectSession(s)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3"><ChannelBadge channel={s.channel} /></td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-900 dark:text-white truncate">{s.userId}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 truncate">{s.preview || '—'}</td>
                    <td className="px-4 py-3"><TokenBadge total={s.totalTokens} prompt={s.promptTokens} completion={s.completionTokens} /></td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(s.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Page {page} of {totalPages} ({total} sessions)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              </button>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages || loading}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile cards */}
        <div className={`lg:hidden space-y-3 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
          {sessions.length === 0 && !loading && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No sessions found</p>
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => selectSession(s)}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 cursor-pointer hover:shadow-lg transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <ChannelBadge channel={s.channel} />
                <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(s.lastMessageAt)}</span>
              </div>
              <p className="text-sm font-mono text-slate-900 dark:text-white mb-1">{s.userId}</p>
              {s.preview && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{s.preview}</p>
              )}
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {fmtTokens(s.totalTokens)} tokens
              </div>
            </div>
          ))}
          {/* Mobile pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1 || loading}
                className="px-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages || loading}
                className="px-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── View: Chat ───────────────────────────────────────────────────────────────
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumb />
      <DateRangeFilter {...dateFilterProps} />

      {/* Session header */}
      <div className="mb-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
        <div className="flex items-center gap-3 mb-3">
          <MessageSquare className="w-5 h-5 text-slate-400" />
          {selectedSession && <ChannelBadge channel={selectedSession.channel} />}
          <span className="text-sm font-mono text-slate-900 dark:text-white">{selectedSession?.userId}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div>Started: <span className="text-slate-700 dark:text-slate-300">{formatDate(selectedSession?.createdAt)}</span></div>
          <div>Last active: <span className="text-slate-700 dark:text-slate-300">{formatDate(selectedSession?.lastMessageAt)}</span></div>
        </div>
        {/* Session token totals — always rendered */}
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-4 text-xs">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Session Tokens: <span className="text-slate-900 dark:text-white font-bold">{fmtTokens(messages?.sessionTotalTokens)}</span>
          </span>
        </div>
      </div>

      <ErrorBanner />

      {/* Message thread */}
      <div className={`transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
        {loading && !messages && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
          </div>
        )}
        {messages && (
          <div className="space-y-3">
            {messages.messages.length === 0 && (
              <p className="text-sm text-center text-slate-500 dark:text-slate-400 py-8">No messages in this session.</p>
            )}
            {messages.messages.map((m, i) => {
              const isUser = m.role === 'user';
              const isTool = m.role === 'tool';

              if (isTool) {
                return (
                  <div key={i} className="mx-auto max-w-2xl">
                    <details className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 dark:text-slate-400">
                      <summary className="cursor-pointer select-none">tool response</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words">{m.content}</pre>
                    </details>
                  </div>
                );
              }

              return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 rounded-bl-sm'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                    <div className={`flex items-center gap-2 mt-1 text-xs ${isUser ? 'text-indigo-200 justify-end' : 'text-slate-400'}`}>
                      <span>{formatDate(m.createdAt)}</span>
                      {!isUser && (m.totalTokens || m.tokens) > 0 && (
                        <span>{fmtTokens(m.totalTokens || m.tokens)} tokens</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatMessages;
