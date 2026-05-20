import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2, Play, Pause, AlertTriangle, Loader2, Calendar, Save, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { flowService } from '../api/flowService';
import { botflowWs } from '../api/botflowWebSocket';
import { DatabaseCard, DB_TYPES } from './GlobalDefault';

// ─── VectorDB config key ↔ DatabaseCard prop mapping ─────────────────────────
// Note: `expand_query_count` and `tool_description` are intentionally omitted
// — those operational params live on the per-flow DatabaseNode (asymmetric
// override). Editing them here would be silently overwritten on the next flow
// save when the bot is tracking GlobalDefault. The bot's flow builder is the
// canonical surface; GlobalDefault provides the system-wide fallback.
const VDB_CONFIG_TO_PROP = {
  endpoint: 'dbConnectionString',
  db_host: 'dbHost', db_port: 'dbPort', db_name: 'dbName',
  db_username: 'dbUsername', db_password: 'dbPassword',
  supabase_url: 'dbSupabaseUrl',
  supabase_anon_key: 'dbSupabaseAnonKey',
  supabase_service_role_key: 'dbSupabaseServiceRoleKey',
  vector_store_name: 'dbVectorStoreName',
  vector_store_id: 'dbVectorStoreId',
  pineconeApiKey: 'dbPineconeApiKey',
  pineconeIndexName: 'dbPineconeIndexName',
  pineconeEnvironment: 'dbPineconeEnvironment',
  weaviateUrl: 'dbWeaviateUrl',
  weaviateApiKey: 'dbWeaviateApiKey',
  weaviateCollectionName: 'dbWeaviateCollectionName',
  chromaHost: 'dbChromaHost', chromaPort: 'dbChromaPort',
  chromaCollectionName: 'dbChromaCollectionName',
  milvusUri: 'dbMilvusUri', milvusToken: 'dbMilvusToken',
  milvusCollectionName: 'dbMilvusCollectionName',
  pgvectorHost: 'dbPgvectorHost', pgvectorPort: 'dbPgvectorPort',
  pgvectorDatabase: 'dbPgvectorDatabase',
  pgvectorUsername: 'dbPgvectorUsername',
  pgvectorPassword: 'dbPgvectorPassword',
  pgvectorTableName: 'dbPgvectorTableName',
};

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

// ─── Per-flow DB-node operational params editor (controlled) ─────────────────
// Pure controlled component: parent owns {topK, desc} per nodeId in editDbNodes.
// Save is consolidated into Bot.jsx's global "Save Config" button; this
// component renders only inputs + an inline per-node error banner.
function DatabaseNodeOpsEditor({ value, onChange, label, error, disabled }) {
  const topK = value?.topK ?? '';
  const desc = value?.desc ?? '';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">Number of Search Queries</label>
          <input
            type="number"
            min="1"
            max="10"
            value={topK}
            placeholder="4"
            disabled={disabled}
            onChange={(e) => onChange({ topK: e.target.value, desc })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">Database Description</label>
          <textarea
            value={desc}
            disabled={disabled}
            onChange={(e) => onChange({ topK, desc: e.target.value })}
            rows={3}
            placeholder="Describe what data this database contains..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-60"
          />
        </div>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// ─── Helpers for the per-flow DB-node editors ────────────────────────────────
function _normalizeDbNodeForCompare(value) {
  // Mirror the omit-empty rules so 'topK="4"' equals stored 4 and "  " desc
  // equals "" — preventing spurious dirty flags.
  const parsed = parseInt((value && value.topK) ?? '', 10);
  const topK = Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(10, parsed))
    : null;
  const desc = String((value && value.desc) || '').trim();
  return { topK, desc };
}

function _dbNodeIsDirty(edited, original) {
  return JSON.stringify(_normalizeDbNodeForCompare(edited))
    !== JSON.stringify(_normalizeDbNodeForCompare({
      topK: original?.expandQueryCount == null ? '' : String(original.expandQueryCount),
      desc: original?.toolDescription || '',
    }));
}

function _dbNodeLabel(node, allDatabases) {
  const type = String(node?.databaseType || '').trim();
  if (!type) return `Database (${String(node?.nodeId || '').slice(-8)})`;
  const titled = type.charAt(0).toUpperCase() + type.slice(1);
  const sameType = (allDatabases || []).filter(
    (d) => String(d?.databaseType || '').trim().toLowerCase() === type.toLowerCase()
  );
  if (sameType.length <= 1) return `${titled} Database`;
  const idx = sameType.findIndex((d) => d.nodeId === node.nodeId) + 1;
  return `${titled} Database ${idx}`;
}


function Bot() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/bot-analytics') ? returnTo : '/bot-analytics';
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFlows, setSelectedFlows] = useState([]);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalConfig, setModalConfig] = useState({ type: '', message: '', action: null, flowId: null });

  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detailStatus, setDetailStatus] = useState(null);
  const [flowConfig, setFlowConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);
  const [providers, setProviders] = useState([]);
  const [expandedFlows, setExpandedFlows] = useState([]);

  // Bot-level config override state
  const [botConfig, setBotConfig] = useState(null);
  const [botConfigLoading, setBotConfigLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editChat, setEditChat] = useState({ providerKey: '', modelId: '', apiKey: '', temperature: null });
  const [editVoice, setEditVoice] = useState({ providerKey: '', modelId: '', apiKey: '', temperature: null });
  const [editInstruction, setEditInstruction] = useState('');
  const [showChatApiKey, setShowChatApiKey] = useState(false);
  const [showVoiceApiKey, setShowVoiceApiKey] = useState(false);
  const [editVectordb, setEditVectordb] = useState({ type: '', config: {} });
  // Per-flow DB-node editors: keyed by nodeId → {topK: string, desc: string}.
  // Owned at this level (state-lift) so the global Save Config button can
  // collect dirty entries and fire per-node PATCHes alongside the bot-config
  // save in a single user action.
  const [editDbNodes, setEditDbNodes] = useState({});
  const [dbNodeErrors, setDbNodeErrors] = useState({});
  const dirtyFields = useRef(new Set());

  // Date filter state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [presetVal, setPresetVal] = useState('');
  // Pagination state
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Refs to avoid stale closures in WebSocket event handlers
  const startDateRef = useRef('');
  const endDateRef = useRef('');
  const searchRef = useRef('');
  const pageRef = useRef(1);
  const selectedFlowRef = useRef(null);
  const [grandTotals, setGrandTotals] = useState({ total: 0, calls: 0, pulses: 0, callDuration: 0, texts: 0, credits: 0, users: 0 });

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
  };

  const fmtTokens = (n) => (n || 0).toLocaleString();

  const formatDuration = (totalSeconds) => {
    if (!totalSeconds) return '—';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);
    if (h > 0) return `${h} hr ${m} min ${s} sec`;
    if (m > 0) return `${m} min ${s} sec`;
    return `${s} sec`;
  };

  const toggleFlowExpand = (flowId) => {
    setExpandedFlows(prev =>
      prev.includes(flowId) ? prev.filter(id => id !== flowId) : [...prev, flowId]
    );
  };

  const fetchFlows = useCallback((sd, ed, { silent = false } = {}) => {
    if (!silent) { setLoading(true); setError(null); }
    const opts = { page: pageRef.current, pageSize: PAGE_SIZE };
    if (sd) opts.startDate = sd;
    if (ed) opts.endDate = ed;
    if (searchRef.current) opts.search = searchRef.current;
    // Track A2: unified-endpoint fetch; adapter in flowService preserves the
    // legacy envelope shape so this render code is unchanged.
    flowService.getFlowsUnified(opts)
      .then((data) => {
        // Merge deleted bots into the displayed list so admins see them
        // inline with a `deleted: true` flag. The backend marks live rows
        // with `deleted: false` already.
        const live = data.flows || [];
        const archived = data.deletedFlows || [];
        setFlows([...live, ...archived]);
        setTotal(data.total || 0);
        setGrandTotals({
          total: data.grandTotalTokens || 0,
          calls: data.grandTotalCalls || 0,
          pulses: data.grandTotalPulses || 0,
          callDuration: data.grandTotalCallDuration || 0,
          texts: data.grandTotalTexts || 0,
          credits: data.grandTotalCredits || 0,
          users: data.grandTotalUsers || 0,
        });
      })
      .catch((err) => { if (!silent) setError(err.message || 'Failed to load flows'); })
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => {
    if (selectedFlow) setDetailStatus(selectedFlow.botStatus);
  }, [selectedFlow]);

  useEffect(() => { fetchFlows(startDate, endDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search: re-fetch from API when search term changes (300ms debounce).
  // Reset to page 1 so the user isn't stranded on an out-of-range page after narrowing.
  const searchMountedRef = useRef(false);
  useEffect(() => {
    if (!searchMountedRef.current) { searchMountedRef.current = true; return; }
    const t = setTimeout(() => {
      if (pageRef.current !== 1) {
        setPage(1); // triggers refetch via the page useEffect
      } else {
        fetchFlows(startDateRef.current, endDateRef.current, { silent: true });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select a flow from URL ?flowId= param (from Bot Analytics "View Details")
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || !flows.length) return;
    const flowId = searchParams.get('flowId');
    const tenantId = searchParams.get('tenantId') || searchParams.get('tenant_id');
    if (!flowId) return;
    const target = flows.find(f => f.flowId === flowId && (!tenantId || f.tenantId === tenantId));
    if (target) {
      handleFlowClick(target);
      autoSelectedRef.current = true;
    }
  }, [flows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep refs in sync so WS handlers always use current values
  useEffect(() => { startDateRef.current = startDate; }, [startDate]);
  useEffect(() => { endDateRef.current = endDate; }, [endDate]);
  useEffect(() => { searchRef.current = searchTerm; }, [searchTerm]);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { selectedFlowRef.current = selectedFlow; }, [selectedFlow]);

  // Refetch when page changes (initial mount handled by the separate useEffect above).
  // skipNextPageEffect lets callers that reset page AND fetch in the same tick avoid a double fetch.
  const pageMountedRef = useRef(false);
  const skipNextPageEffect = useRef(false);
  useEffect(() => {
    if (!pageMountedRef.current) { pageMountedRef.current = true; return; }
    if (skipNextPageEffect.current) { skipNextPageEffect.current = false; return; }
    fetchFlows(startDateRef.current, endDateRef.current);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySearch = () => {
    searchRef.current = searchTerm;
    if (pageRef.current !== 1) {
      pageRef.current = 1;
      skipNextPageEffect.current = true;
      setPage(1);
    }
    fetchFlows(startDateRef.current, endDateRef.current);
  };

  // ─── Real-time WebSocket sync + REST polling failsafe ─────────────────────
  const wsConnectedRef = useRef(false);
  const pollingRef = useRef(null);
  const pollDelayRef = useRef(null);
  const POLL_INTERVAL = 15000;

  // Helper that always uses current date filter values via refs
  const fetchFlowsCurrent = useCallback(() => {
    fetchFlows(startDateRef.current, endDateRef.current);
  }, [fetchFlows]);

  // Silent re-fetch for WebSocket events — updates values without loading/dim effect
  const fetchFlowsSilent = useCallback(() => {
    fetchFlows(startDateRef.current, endDateRef.current, { silent: true });
  }, [fetchFlows]);

  useEffect(() => {
    botflowWs.connect(); // No tenant_id = admin group (sees ALL tenants)

    const offConnected = botflowWs.on('connected', () => {
      wsConnectedRef.current = true;
      if (pollDelayRef.current) {
        clearTimeout(pollDelayRef.current);
        pollDelayRef.current = null;
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    });

    const offDisconnected = botflowWs.on('disconnected', () => {
      wsConnectedRef.current = false;
      pollDelayRef.current = setTimeout(() => {
        if (!wsConnectedRef.current && !pollingRef.current) {
          pollingRef.current = setInterval(fetchFlowsCurrent, POLL_INTERVAL);
        }
      }, 20000);
    });

    // Track B: bot rows are mutable aggregates (status/tokens/credits); since_ts
    // catch-up does not apply. Intentional blind refetch.
    const offReconnected = botflowWs.on('reconnected', fetchFlowsCurrent);

    const offStatusChanged = botflowWs.on('bot.status_changed', (payload) => {
      if (!payload?.bot_key) return;
      setFlows(prev => prev.map(f =>
        f.flowId === payload.bot_key && f.tenantId === payload.tenant_id
          ? { ...f, botStatus: payload.status }
          : f
      ));
    });

    const offBotCreated = botflowWs.on('bot.created', fetchFlowsCurrent);
    const offBotUpdated = botflowWs.on('bot.updated', fetchFlowsCurrent);
    const offBotDeleted = botflowWs.on('bot.deleted', fetchFlowsCurrent);

    // Refresh the open detail panel when cascade (or another admin's PUT)
    // changes this bot's config. Scoped to selectedFlow via ref to dodge
    // stale-closure capture of the effect's initial selectedFlow=null.
    const offBotConfigUpdated = botflowWs.on('bot.config_updated', (payload) => {
      const sf = selectedFlowRef.current;
      if (!sf) return;
      if (payload?.bot_key !== sf.flowId || payload?.tenant_id !== sf.tenantId) return;
      flowService.getBotConfig(sf.flowId, sf.tenantId)
        .then((data) => {
          setBotConfig(data);
          setEditChat({
            providerKey: data.chat?.provider_key || '',
            modelId: data.chat?.model_id || '',
            apiKey: data.chat?.api_key || '',
            temperature: data.chat?.temperature,
          });
          setEditVoice({
            providerKey: data.voice?.provider_key || '',
            modelId: data.voice?.model_id || '',
            apiKey: data.voice?.api_key || '',
            temperature: data.voice?.temperature,
          });
          setEditInstruction(data.instruction || '');
          setEditVectordb({
            type: data.vectordb?.type || '',
            config: { ...(data.vectordb?.config || {}) },
          });
          dirtyFields.current = new Set();
        })
        .catch(() => {});
    });
    const offFlowCreated = botflowWs.on('flow.created', fetchFlowsCurrent);
    const offFlowUpdated = botflowWs.on('flow.updated', fetchFlowsCurrent);
    const offFlowPublished = botflowWs.on('flow.published', fetchFlowsCurrent);
    const offFlowDeleted = botflowWs.on('flow.deleted', fetchFlowsCurrent);

    // Debounced silent re-fetch for stats, executions, and credits
    let statsDebounceTimer = null;
    const debouncedFetchFlows = () => {
      if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
      statsDebounceTimer = setTimeout(() => {
        fetchFlowsSilent();
      }, 2000);
    };
    const offStats = botflowWs.on('stats.updated', debouncedFetchFlows);
    const offExecCompleted = botflowWs.on('execution.completed', debouncedFetchFlows);
    const offCreditsDeducted = botflowWs.on('credits.deducted', debouncedFetchFlows);

    return () => {
      offConnected();
      offDisconnected();
      offReconnected();
      offStatusChanged();
      offBotCreated();
      offBotUpdated();
      offBotDeleted();
      offBotConfigUpdated();
      offFlowCreated();
      offFlowUpdated();
      offFlowPublished();
      offFlowDeleted();
      offStats();
      offExecCompleted();
      offCreditsDeducted();
      if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
      botflowWs.disconnect();
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (pollDelayRef.current) {
        clearTimeout(pollDelayRef.current);
        pollDelayRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyDateFilter = (sd, ed) => {
    pageRef.current = 1;
    skipNextPageEffect.current = true;
    setPage(1);
    fetchFlows(sd !== undefined ? sd : startDate, ed !== undefined ? ed : endDate);
  };
  const clearDateFilter = () => {
    setStartDate('');
    setEndDate('');
    pageRef.current = 1;
    skipNextPageEffect.current = true;
    setPage(1);
    fetchFlows('', '');
  };

  useEffect(() => {
    flowService.getProviders()
      .then((data) => setProviders(data || []))
      .catch(() => {});
  }, []);

  const filteredFlows = flows.filter(flow =>
    flow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    flow.flowId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (flow.tenantName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleFlowClick = (flow) => {
    setSelectedFlow(flow);
    setShowDetails(true);
    setFlowConfig(null);
    setConfigError(null);
    setConfigLoading(true);
    setBotConfig(null);
    setShowChatApiKey(false);
    setShowVoiceApiKey(false);
    flowService.getFlowConfig(flow.flowId, flow.tenantId)
      .then((data) => {
        setFlowConfig(data);
        // Seed per-DB-node editor state from the loaded flow config so the
        // editors render with current values and dirty-detection has a clean
        // baseline.
        const seed = {};
        for (const db of (data?.databases || [])) {
          seed[db.nodeId] = {
            topK: db.expandQueryCount == null ? '' : String(db.expandQueryCount),
            desc: db.toolDescription || '',
          };
        }
        setEditDbNodes(seed);
        setDbNodeErrors({});
      })
      .catch((err) => setConfigError(err.message || 'Failed to load flow config'))
      .finally(() => setConfigLoading(false));
    // Load bot-level config for editable overrides
    dirtyFields.current = new Set();
    setBotConfigLoading(true);
    flowService.getBotConfig(flow.flowId, flow.tenantId)
      .then((data) => {
        setBotConfig(data);
        setEditChat({
          providerKey: data.chat?.provider_key || '',
          modelId: data.chat?.model_id || '',
          apiKey: data.chat?.api_key || '',
          temperature: data.chat?.temperature,
        });
        setEditVoice({
          providerKey: data.voice?.provider_key || '',
          modelId: data.voice?.model_id || '',
          apiKey: data.voice?.api_key || '',
          temperature: data.voice?.temperature,
        });
        setEditInstruction(data.instruction || '');
        setEditVectordb({
          type: data.vectordb?.type || '',
          config: { ...(data.vectordb?.config || {}) },
        });
      })
      .catch(() => {})
      .finally(() => setBotConfigLoading(false));
  };

  const handleCheckboxChange = (flowId, checked) => {
    if (checked) {
      setSelectedFlows([...selectedFlows, flowId]);
    } else {
      setSelectedFlows(selectedFlows.filter(id => id !== flowId));
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedFlows(filteredFlows.map(flow => flow.flowId));
    } else {
      setSelectedFlows([]);
    }
  };

  const openModal = (type, message, action, flowId = null) => {
    setModalConfig({ type, message, action, flowId });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalConfig({ type: '', message: '', action: null, flowId: null });
  };

  const handleConfirm = () => {
    setError(null);
    if (modalConfig.action) {
      modalConfig.action();
    }
    closeModal();
  };

  const handleSaveDetail = () => {
    if (!selectedFlow || detailStatus === selectedFlow.botStatus) return;
    setError(null);
    flowService.setStatus(selectedFlow.flowId, selectedFlow.tenantId, detailStatus)
      .then(() => {
        setSelectedFlow(prev => ({ ...prev, botStatus: detailStatus }));
        setFlows(prev => prev.map(f =>
          f.flowId === selectedFlow.flowId ? { ...f, botStatus: detailStatus } : f
        ));
      })
      .catch((err) => setError(err.message));
  };

  // --- Bot config override helpers ---
  const getModelsForProvider = (providerKey) => {
    const p = providers.find((pr) => pr.key === providerKey);
    return p ? p.models : [];
  };

  const markDirty = (field) => dirtyFields.current.add(field);

  // Three-state badge for each group's default tracking status:
  //   'tracking'   — is_default=true, default_overridden=false (blue badge)
  //   'overridden' — is_default=true, default_overridden=true  (amber badge)
  //   null         — is_default=false (no badge; flow pins it)
  const defaultBadgeState = (group) => {
    const g = botConfig?.[group];
    if (!g?.is_default) return null;
    return g.default_overridden ? 'overridden' : 'tracking';
  };

  const handleSaveConfig = async () => {
    if (!selectedFlow || savingConfig) return;
    const dirty = dirtyFields.current;
    // Compute dirty per-flow DB-node entries (state-diff vs flowConfig).
    const dirtyDbNodes = (flowConfig?.databases || [])
      .filter((db) => editDbNodes[db.nodeId] && _dbNodeIsDirty(editDbNodes[db.nodeId], db));
    if (dirty.size === 0 && dirtyDbNodes.length === 0) {
      toast('No changes to save');
      return;
    }
    setSavingConfig(true);
    try {
      // 1) Bot-config save (existing behavior). Skip PATCHes if this fails.
      let updated = null;
      if (dirty.size > 0) {
        const payload = { bot_key: selectedFlow.flowId, tenant_id: selectedFlow.tenantId };
        if (dirty.has('chat_provider_key')) payload.chat_provider_key = editChat.providerKey;
        if (dirty.has('chat_model_id')) payload.chat_model_id = editChat.modelId;
        if (dirty.has('chat_api_key')) payload.chat_api_key = editChat.apiKey;
        if (dirty.has('chat_temperature')) payload.chat_temperature = editChat.temperature;
        if (dirty.has('voice_provider_key')) payload.voice_provider_key = editVoice.providerKey;
        if (dirty.has('voice_model_id')) payload.voice_model_id = editVoice.modelId;
        if (dirty.has('voice_api_key')) payload.voice_api_key = editVoice.apiKey;
        if (dirty.has('voice_temperature')) payload.voice_temperature = editVoice.temperature;
        if (dirty.has('instruction')) payload.instruction = editInstruction;
        if (dirty.has('vectordb_type')) payload.vectordb_type = editVectordb.type;
        if (dirty.has('vectordb_config')) payload.vectordb_config = editVectordb.config;
        updated = await flowService.updateBotConfig(payload);
        setBotConfig(updated);
        setEditChat({
          providerKey: updated.chat?.provider_key || '',
          modelId: updated.chat?.model_id || '',
          apiKey: updated.chat?.api_key || '',
          temperature: updated.chat?.temperature,
        });
        setEditVoice({
          providerKey: updated.voice?.provider_key || '',
          modelId: updated.voice?.model_id || '',
          apiKey: updated.voice?.api_key || '',
          temperature: updated.voice?.temperature,
        });
        setEditInstruction(updated.instruction || '');
        setEditVectordb({
          type: updated.vectordb?.type || '',
          config: { ...(updated.vectordb?.config || {}) },
        });
        dirtyFields.current = new Set();
      }

      // 2) Per-flow DB-node PATCHes via Promise.allSettled (independent;
      //    partial-success surfaces per-node errors instead of rolling back).
      let patchSuccessCount = 0;
      let patchFailCount = 0;
      const newErrors = { ...dbNodeErrors };
      if (dirtyDbNodes.length > 0) {
        const flowId = selectedFlow.flowId;
        const tenantId = selectedFlow.tenantId;
        const settled = await Promise.allSettled(dirtyDbNodes.map((db) => {
          const edited = editDbNodes[db.nodeId];
          const parsed = parseInt((edited && edited.topK) ?? '', 10);
          const body = {};
          body.expandQueryCount = (Number.isFinite(parsed) && parsed > 0)
            ? Math.max(1, Math.min(10, parsed))
            : '';
          body.toolDescription = String((edited && edited.desc) || '').trim();
          return flowService.updateFlowDatabaseNode(flowId, db.nodeId, tenantId, body)
            .then((res) => ({ nodeId: db.nodeId, res }));
        }));
        const updatedDatabases = [...(flowConfig?.databases || [])];
        const nextEditDbNodes = { ...editDbNodes };
        settled.forEach((r, i) => {
          const nodeId = dirtyDbNodes[i].nodeId;
          if (r.status === 'fulfilled') {
            patchSuccessCount += 1;
            const updatedNode = r.value.res?.node || {};
            const idx = updatedDatabases.findIndex((d) => d.nodeId === nodeId);
            if (idx >= 0) {
              updatedDatabases[idx] = { ...updatedDatabases[idx], ...updatedNode };
            }
            nextEditDbNodes[nodeId] = {
              topK: updatedNode.expandQueryCount == null ? '' : String(updatedNode.expandQueryCount),
              desc: updatedNode.toolDescription || '',
            };
            delete newErrors[nodeId];
          } else {
            patchFailCount += 1;
            newErrors[nodeId] = (r.reason && r.reason.message) || 'Failed to save';
          }
        });
        setFlowConfig((prev) => prev ? ({ ...prev, databases: updatedDatabases }) : prev);
        setEditDbNodes(nextEditDbNodes);
        setDbNodeErrors(newErrors);
        // Refetch botConfig so the read-only DatabaseCard reflects the
        // cascade-merged Bot.vectordb_config values.
        try {
          const refreshed = await flowService.getBotConfig(selectedFlow.flowId, selectedFlow.tenantId);
          setBotConfig(refreshed);
        } catch { /* non-fatal botConfig refetch */ }
      }

      // 3) Summary toast.
      const totalPatch = dirtyDbNodes.length;
      if (dirty.size > 0 && patchFailCount === 0) {
        toast.success('Saved');
      } else if (totalPatch === 0) {
        toast.success('Bot config saved');
      } else if (patchFailCount === 0) {
        toast.success(`Saved (${patchSuccessCount} flow node${patchSuccessCount === 1 ? '' : 's'} updated)`);
      } else {
        toast.error(`Saved ${patchSuccessCount} of ${totalPatch} flow nodes — see errors below`);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save bot config');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetToDefault = async (type) => {
    if (!selectedFlow || savingConfig) return;
    setSavingConfig(true);
    try {
      const payload = {
        bot_key: selectedFlow.flowId,
        tenant_id: selectedFlow.tenantId,
        [`reset_${type}_to_default`]: true,
      };
      const updated = await flowService.updateBotConfig(payload);
      setBotConfig(updated);
      if (type === 'chat') {
        setEditChat({
          providerKey: updated.chat?.provider_key || '',
          modelId: updated.chat?.model_id || '',
          apiKey: updated.chat?.api_key || '',
          temperature: updated.chat?.temperature,
        });
      } else if (type === 'voice') {
        setEditVoice({
          providerKey: updated.voice?.provider_key || '',
          modelId: updated.voice?.model_id || '',
          apiKey: updated.voice?.api_key || '',
          temperature: updated.voice?.temperature,
        });
      } else if (type === 'vectordb') {
        setEditVectordb({
          type: updated.vectordb?.type || '',
          config: { ...(updated.vectordb?.config || {}) },
        });
      }
      // Only clear dirty fields for the reset section, preserve others (e.g. instruction)
      const resetPrefix = type === 'chat' ? 'chat_' : type === 'voice' ? 'voice_' : 'vectordb_';
      for (const key of [...dirtyFields.current]) {
        if (key.startsWith(resetPrefix)) dirtyFields.current.delete(key);
      }
      const labels = { chat: 'Chat model', voice: 'Voice model', vectordb: 'Vector database' };
      toast.success(`${labels[type]} reset to global default`);
    } catch (err) {
      toast.error(err.message || 'Failed to reset to default');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDelete = (flowId, e) => {
    e.stopPropagation();
    const flow = flows.find(f => f.flowId === flowId);
    const tenantId = flow?.tenantId;
    openModal(
      'delete',
      `Delete bot "${flow?.name || flowId}"? Conversation history, calls, credits, and notifications are retained.`,
      () => {
        flowService.deleteBot(flowId, tenantId)
          .then((res) => {
            if (res.purged) {
              toast.success('Test bot purged');
            } else if (res.already_deleted) {
              toast('Bot was already deleted', { icon: 'ℹ️' });
            } else {
              toast.success('Bot moved to Deleted Bots');
            }
            setFlows(prev => prev.filter(f => !(f.flowId === flowId && f.tenantId === tenantId)));
            setSelectedFlows(prev => prev.filter(id => id !== flowId));
          })
          .catch((err) => {
            toast.error(err.message || 'Delete failed');
            setError(err.message);
          });
      },
      flowId,
    );
  };

  const handleActivate = (flowId, e) => {
    e.stopPropagation();
    const flow = flows.find(f => f.flowId === flowId);
    const isActive = flow?.botStatus === 'active';
    const tenantId = flow?.tenantId;
    const newStatus = isActive ? 'inactive' : 'active';
    const message = isActive
      ? 'Are you sure you want to deactivate this flow?'
      : 'Are you sure you want to activate this flow?';
    const actionType = isActive ? 'deactivate' : 'activate';

    openModal(actionType, message, () => {
      flowService.setStatus(flowId, tenantId, newStatus)
        .then(() => {
          setFlows(prev => prev.map(f =>
            f.flowId === flowId ? { ...f, botStatus: newStatus } : f
          ));
        })
        .catch((err) => setError(err.message));
    }, flowId);
  };

  const handleDeactivate = (flowId, e) => {
    e.stopPropagation();
    const flow = flows.find(f => f.flowId === flowId);
    const isActive = flow?.botStatus === 'active';
    const tenantId = flow?.tenantId;
    const newStatus = isActive ? 'inactive' : 'active';
    const message = isActive
      ? 'Are you sure you want to deactivate this flow?'
      : 'Are you sure you want to activate this flow?';
    const actionType = isActive ? 'deactivate' : 'activate';

    openModal(actionType, message, () => {
      flowService.setStatus(flowId, tenantId, newStatus)
        .then(() => {
          setFlows(prev => prev.map(f =>
            f.flowId === flowId ? { ...f, botStatus: newStatus } : f
          ));
        })
        .catch((err) => setError(err.message));
    }, flowId);
  };

  const handleBulkDelete = () => {
    if (selectedFlows.length === 0) return;
    const bots = selectedFlows
      .map(id => {
        const f = flows.find(f => f.flowId === id);
        return f ? { botKey: f.flowId, tenantId: f.tenantId } : null;
      })
      .filter(Boolean);
    openModal(
      'delete',
      `Delete ${bots.length} bot(s)? Conversation history and billing data will be retained.`,
      () => {
        flowService.bulkDeleteBots(bots)
          .then(() => {
            toast.success(`${bots.length} bot(s) moved to Deleted Bots`);
            const keys = new Set(bots.map(b => `${b.tenantId}::${b.botKey}`));
            setFlows(prev => prev.filter(f => !keys.has(`${f.tenantId}::${f.flowId}`)));
            setSelectedFlows([]);
          })
          .catch((err) => {
            toast.error(err.message || 'Bulk delete failed');
            setError(err.message);
          });
      },
    );
  };

  const handleBulkActivate = () => {
    if (selectedFlows.length === 0) return;
    const bots = selectedFlows
      .map(id => { const f = flows.find(f => f.flowId === id); return f ? { botKey: f.flowId, tenantId: f.tenantId } : null; })
      .filter(Boolean);
    openModal('activate', `Are you sure you want to activate ${selectedFlows.length} flow(s)?`, () => {
      flowService.bulkSetStatus(bots, 'active')
        .then(() => {
          setFlows(prev => prev.map(f =>
            selectedFlows.includes(f.flowId) ? { ...f, botStatus: 'active' } : f
          ));
          setSelectedFlows([]);
        })
        .catch((err) => setError(err.message));
    });
  };

  const handleBulkDeactivate = () => {
    if (selectedFlows.length === 0) return;
    const bots = selectedFlows
      .map(id => { const f = flows.find(f => f.flowId === id); return f ? { botKey: f.flowId, tenantId: f.tenantId } : null; })
      .filter(Boolean);
    openModal('deactivate', `Are you sure you want to deactivate ${selectedFlows.length} flow(s)?`, () => {
      flowService.bulkSetStatus(bots, 'inactive')
        .then(() => {
          setFlows(prev => prev.map(f =>
            selectedFlows.includes(f.flowId) ? { ...f, botStatus: 'inactive' } : f
          ));
          setSelectedFlows([]);
        })
        .catch((err) => setError(err.message));
    });
  };

  const DetailRow = ({ label, value }) => {
    if (value === '' || value === null || value === undefined) return null;
    return (
      <div className="flex flex-col sm:flex-row sm:gap-3 text-sm py-1">
        <span className="text-slate-500 dark:text-slate-400 sm:w-36 shrink-0 text-xs font-medium">{label}</span>
        <span className="text-slate-900 dark:text-white flex-1 break-all">
          {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
        </span>
      </div>
    );
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      {returnTo && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => navigate(safeReturnTo)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Bot Analytics
          </button>
        </div>
      )}
      {!showDetails ? (
        <>
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Select flow to change
            </h1>
          </div>

          {/* Date Filter */}
          <div className="mb-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400 shrink-0 hidden sm:block" />
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <span className="text-sm font-medium text-slate-400">to</span>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <select
                value={presetVal}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  if (isNaN(idx)) return;
                  const preset = DATE_PRESETS[idx];
                  const sd = toLocalISO(preset.offset());
                  const ed = toLocalISO(new Date());
                  setStartDate(sd);
                  setEndDate(ed);
                  applyDateFilter(sd, ed);
                  setPresetVal('');
                }}
                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="" disabled>Quick select...</option>
                {DATE_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>{p.label}</option>
                ))}
              </select>
              <button
                onClick={() => applyDateFilter()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Apply
              </button>
              {(startDate || endDate) && (
                <button
                  onClick={clearDateFilter}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  title="Clear date filter"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Stats tiles */}
          <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Flows</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtTokens(total)}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Text - Call</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtTokens(grandTotals.texts)} - {fmtTokens(grandTotals.calls)}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Call Duration</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatDuration(grandTotals.callDuration)}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Tokens</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtTokens(grandTotals.total)}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Pulses</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtTokens(grandTotals.pulses)}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Credits Used</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{(grandTotals.credits || 0).toFixed(2)}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Users</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{fmtTokens(grandTotals.users)}</div>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Search Bar */}
          <div className="mb-4 flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="Search flows..."
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <button onClick={applySearch} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors whitespace-nowrap">
              Search
            </button>
          </div>

          {/* Bulk Actions Bar */}
          {selectedFlows.length > 0 && (
            <div className="mb-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {selectedFlows.length} flow(s) selected
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleBulkActivate}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
                  >
                    <Play className="w-4 h-4" />
                    <span className="hidden sm:inline">Activate</span>
                  </button>
                  <button
                    onClick={handleBulkDeactivate}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
                  >
                    <Pause className="w-4 h-4" />
                    <span className="hidden sm:inline">Deactivate</span>
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Delete</span>
                  </button>
                  <button
                    onClick={() => setSelectedFlows([])}
                    className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors text-sm"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          )}


          {/* Desktop Table */}
          <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden relative">
            {loading && (
              <div className="absolute top-2 right-3 z-10">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full table-auto">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left w-[3%]">
                      <input
                        type="checkbox"
                        checked={selectedFlows.length === filteredFlows.length && filteredFlows.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">BOT NAME</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">TENANT</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">STATUS</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">TOKENS</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">CREDITS</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-200 dark:divide-slate-700 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
                  {filteredFlows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        No flows found
                      </td>
                    </tr>
                  )}
                  {filteredFlows.map((flow) => (
                    <React.Fragment key={flow.flowId}>
                      <tr
                        onClick={() => toggleFlowExpand(flow.flowId)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedFlows.includes(flow.flowId)}
                            onChange={(e) => handleCheckboxChange(flow.flowId, e.target.checked)}
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div>
                            <div className="text-slate-900 dark:text-white font-semibold">{flow.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{flow.flowId}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {flow.tenantName ? (
                            <div>
                              <div className="text-slate-900 dark:text-white font-medium">{flow.tenantName}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{flow.tenantId}</div>
                            </div>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400 font-mono text-xs">{flow.tenantId}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {flow.deleted ? (
                            <span
                              className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400"
                              title={flow.deletedAt ? `Deleted at ${new Date(flow.deletedAt).toLocaleString()}` : 'Deleted'}
                            >
                              deleted
                            </span>
                          ) : (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              flow.botStatus === 'active'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                            }`}>
                              {flow.botStatus}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
                          {fmtTokens(flow.totalTokens)}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
                          {flow.creditsUsed != null ? flow.creditsUsed.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {flow.deleted ? (
                              <span className="text-xs text-slate-400 italic">
                                archived
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={(e) => handleDelete(flow.flowId, e)}
                                  className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                                {flow.botStatus === 'active' ? (
                                  <button
                                    onClick={(e) => handleDeactivate(flow.flowId, e)}
                                    className="p-1.5 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors"
                                    title="Deactivate"
                                  >
                                    <Pause className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => handleActivate(flow.flowId, e)}
                                    className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                    title="Activate"
                                  >
                                    <Play className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              onClick={() => toggleFlowExpand(flow.flowId)}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                            >
                              {expandedFlows.includes(flow.flowId) ? (
                                <ChevronUp className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedFlows.includes(flow.flowId) && (
                        <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Users</div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtTokens(flow.users)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Calls</div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtTokens(flow.calls)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Texts</div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtTokens(flow.texts)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Pulses</div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtTokens(flow.totalPulses)}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Call Duration</div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{formatDuration(flow.totalCallDuration)}</div>
                                {flow.avgCallDuration > 0 && (
                                  <div className="text-xs text-slate-500 dark:text-slate-400">Avg: {Math.round(flow.avgCallDuration)}s</div>
                                )}
                              </div>
                              <div className="col-span-2">
                                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Last Message</div>
                                {flow.lastMessage ? (
                                  <div>
                                    <div className="text-sm text-slate-900 dark:text-white truncate max-w-[300px]" title={flow.lastMessage}>{flow.lastMessage}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">{flow.lastMessageTime ? formatDate(flow.lastMessageTime) : '—'}</div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-slate-400 dark:text-slate-500">—</span>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                              <button
                                onClick={() => handleFlowClick(flow)}
                                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                              >
                                View full details →
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {total > 0 ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} flows` : `${filteredFlows.length} flows`}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1 || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages || loading}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Card View */}
          <div className={`lg:hidden space-y-3 transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
            {filteredFlows.map((flow) => (
              <div
                key={flow.flowId}
                onClick={() => handleFlowClick(flow)}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4 cursor-pointer hover:shadow-lg transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedFlows.includes(flow.flowId)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleCheckboxChange(flow.flowId, e.target.checked);
                      }}
                      className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {flow.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                        {flow.flowId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => handleDelete(flow.flowId, e)}
                      className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {flow.botStatus === 'active' ? (
                      <button
                        onClick={(e) => handleDeactivate(flow.flowId, e)}
                        className="p-1.5 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors"
                        title="Deactivate"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleActivate(flow.flowId, e)}
                        className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                        title="Activate"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Status:</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      flow.botStatus === 'active'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                    }`}>
                      {flow.botStatus}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div className="text-slate-500 dark:text-slate-400 mb-1">Tenant:</div>
                    {flow.tenantName && (
                      <div className="text-slate-900 dark:text-white text-sm font-medium mb-0.5">
                        {flow.tenantName}
                      </div>
                    )}
                    <div className="text-slate-600 dark:text-slate-400 font-mono text-xs break-all">
                      {flow.tenantId}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Users:</span>
                    <span className="text-slate-600 dark:text-slate-400">{fmtTokens(flow.users)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Calls / Texts:</span>
                    <span className="text-slate-600 dark:text-slate-400">{fmtTokens(flow.calls)} / {fmtTokens(flow.texts)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Tokens:</span>
                    <span className="text-slate-600 dark:text-slate-400">{fmtTokens(flow.totalTokens)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Pulses:</span>
                    <span className="text-slate-600 dark:text-slate-400">{fmtTokens(flow.totalPulses)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Call Duration:</span>
                    <span className="text-slate-600 dark:text-slate-400">{formatDuration(flow.totalCallDuration)}</span>
                  </div>
                </div>
              </div>
            ))}
            {filteredFlows.length === 0 && (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-8 text-center">
                <p className="text-slate-600 dark:text-slate-400">No flows found</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Details View */}
          <div className="mb-6">
            <button
              onClick={() => { if (dirtyFields.current.size > 0 && !confirm('You have unsaved changes. Leave anyway?')) return; setShowDetails(false); setFlowConfig(null); setBotConfig(null); setConfigError(null); dirtyFields.current = new Set(); }}
              className="mb-4 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-2 font-medium"
            >
              <ChevronLeft className="w-5 h-5" />
              Back to list
            </button>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Change flow
            </h1>
          </div>

          {selectedFlow && (
            <div className="space-y-6">
              {/* Bot Info */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {selectedFlow.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {selectedFlow.flowId}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Flow:
                    </label>
                    <input
                      type="text"
                      value={selectedFlow.name}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                      {selectedFlow.flowId}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Tenant:
                    </label>
                    <input
                      type="text"
                      value={selectedFlow.tenantName || selectedFlow.tenantId}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                      {selectedFlow.tenantId}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Bot status:
                    </label>
                    <select
                      value={detailStatus ?? ''}
                      onChange={(e) => setDetailStatus(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Last active:
                    </label>
                    <input
                      type="text"
                      value={formatDate(selectedFlow.lastActive)}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Total tokens:
                    </label>
                    <input
                      type="text"
                      value={selectedFlow.totalTokens != null ? selectedFlow.totalTokens.toLocaleString() : '—'}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Last message:
                    </label>
                    <input
                      type="text"
                      value={selectedFlow.lastMessage || '—'}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Created at:
                    </label>
                    <input
                      type="text"
                      value={formatDate(selectedFlow.createdAt)}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Updated at:
                    </label>
                    <input
                      type="text"
                      value={formatDate(selectedFlow.updatedAt)}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>



              {/* Flow Configuration */}
              {configLoading && (
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading flow configuration…</span>
                </div>
              )}
              {configError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {configError}
                </div>
              )}

              {flowConfig && (
                <>
                  {/* Triggers */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Triggers</h3>
                    {(flowConfig.triggers || []).length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No triggers configured</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(flowConfig.triggers || []).map((trigger, i) => (
                          <span key={trigger.nodeId || i} className="inline-block px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                            {trigger.platform || 'trigger'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Chat Model — editable from bot config */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Chat Model</h3>
                        {defaultBadgeState('chat') === 'tracking' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Source: Global Default</span>
                        )}
                        {defaultBadgeState('chat') === 'overridden' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Overridden — global default will not cascade</span>
                        )}
                      </div>
                      {botConfig?.chat?.is_default && (
                        <button onClick={() => handleResetToDefault('chat')} disabled={savingConfig} className="text-xs text-blue-500 hover:text-blue-600 disabled:text-blue-300">
                          Reset to Global Default
                        </button>
                      )}
                    </div>
                    {botConfig?.chat?.is_default && botConfig?.global_default?.chatmodel && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                        Global default: {botConfig.global_default.chatmodel.provider}/{botConfig.global_default.chatmodel.model}
                      </p>
                    )}
                    {botConfigLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                    ) : (
                      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Provider</label>
                            <select
                              value={editChat.providerKey}
                              onChange={(e) => { setEditChat(prev => ({ ...prev, providerKey: e.target.value, modelId: '' })); markDirty('chat_provider_key'); markDirty('chat_model_id'); }}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">Select provider</option>
                              {providers.map(p => (
                                <option key={p.key} value={p.key}>{p.name}</option>
                              ))}
                              {editChat.providerKey && !providers.find(p => p.key === editChat.providerKey) && (
                                <option value={editChat.providerKey}>{editChat.providerKey}</option>
                              )}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Model</label>
                            <select
                              value={editChat.modelId}
                              onChange={(e) => { setEditChat(prev => ({ ...prev, modelId: e.target.value })); markDirty('chat_model_id'); }}
                              disabled={!editChat.providerKey}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">Select model</option>
                              {getModelsForProvider(editChat.providerKey).map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                              {editChat.modelId && !getModelsForProvider(editChat.providerKey).includes(editChat.modelId) && (
                                <option value={editChat.modelId}>{editChat.modelId}</option>
                              )}
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Temperature</label>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{editChat.temperature ?? '—'}</span>
                            </div>
                            <input
                              type="range" min="0" max="2" step="0.1"
                              value={editChat.temperature ?? 0.7}
                              onChange={(e) => { setEditChat(prev => ({ ...prev, temperature: parseFloat(e.target.value) })); markDirty('chat_temperature'); }}
                              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-blue-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                              <span>0</span><span>1</span><span>2</span>
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">API Key</label>
                            <div className="relative">
                              <input
                                type={showChatApiKey ? 'text' : 'password'}
                                value={editChat.apiKey}
                                onChange={(e) => { setEditChat(prev => ({ ...prev, apiKey: e.target.value })); markDirty('chat_api_key'); }}
                                placeholder="Enter API Key"
                                className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                              <button type="button" onClick={() => setShowChatApiKey(!showChatApiKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                {showChatApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Voice Model — editable from bot config */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Voice Model</h3>
                        {defaultBadgeState('voice') === 'tracking' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Source: Global Default</span>
                        )}
                        {defaultBadgeState('voice') === 'overridden' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Overridden — global default will not cascade</span>
                        )}
                      </div>
                      {botConfig?.voice?.is_default && (
                        <button onClick={() => handleResetToDefault('voice')} disabled={savingConfig} className="text-xs text-blue-500 hover:text-blue-600 disabled:text-blue-300">
                          Reset to Global Default
                        </button>
                      )}
                    </div>
                    {botConfig?.voice?.is_default && botConfig?.global_default?.voicemodel && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                        Global default: {botConfig.global_default.voicemodel.provider}/{botConfig.global_default.voicemodel.model}
                      </p>
                    )}
                    {botConfigLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                    ) : (
                      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Provider</label>
                            <select
                              value={editVoice.providerKey}
                              onChange={(e) => { setEditVoice(prev => ({ ...prev, providerKey: e.target.value, modelId: '' })); markDirty('voice_provider_key'); markDirty('voice_model_id'); }}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">Select provider</option>
                              {providers.map(p => (
                                <option key={p.key} value={p.key}>{p.name}</option>
                              ))}
                              {editVoice.providerKey && !providers.find(p => p.key === editVoice.providerKey) && (
                                <option value={editVoice.providerKey}>{editVoice.providerKey}</option>
                              )}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Model</label>
                            <select
                              value={editVoice.modelId}
                              onChange={(e) => { setEditVoice(prev => ({ ...prev, modelId: e.target.value })); markDirty('voice_model_id'); }}
                              disabled={!editVoice.providerKey}
                              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">Select model</option>
                              {getModelsForProvider(editVoice.providerKey).map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                              {editVoice.modelId && !getModelsForProvider(editVoice.providerKey).includes(editVoice.modelId) && (
                                <option value={editVoice.modelId}>{editVoice.modelId}</option>
                              )}
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Temperature</label>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{editVoice.temperature ?? '—'}</span>
                            </div>
                            <input
                              type="range" min="0" max="2" step="0.1"
                              value={editVoice.temperature ?? 0.7}
                              onChange={(e) => { setEditVoice(prev => ({ ...prev, temperature: parseFloat(e.target.value) })); markDirty('voice_temperature'); }}
                              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-blue-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                              <span>0</span><span>1</span><span>2</span>
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">API Key</label>
                            <div className="relative">
                              <input
                                type={showVoiceApiKey ? 'text' : 'password'}
                                value={editVoice.apiKey}
                                onChange={(e) => { setEditVoice(prev => ({ ...prev, apiKey: e.target.value })); markDirty('voice_api_key'); }}
                                placeholder="Enter API Key"
                                className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                              <button type="button" onClick={() => setShowVoiceApiKey(!showVoiceApiKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                {showVoiceApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Instructions — editable from bot config */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Agent</h3>
                    {botConfigLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Instructions</label>
                          <textarea
                            value={editInstruction}
                            onChange={(e) => { setEditInstruction(e.target.value); markDirty('instruction'); }}
                            rows={8}
                            placeholder="Enter agent instructions..."
                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                          />
                          <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">Note: Instruction resets when flow is re-saved from BotFlowBuilder.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Database */}
                  <div>
                    {botConfig?.vectordb?.is_default && (
                      <div className="flex items-center justify-between mb-2">
                        {defaultBadgeState('vectordb') === 'tracking' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                            Source: Global Default
                          </span>
                        )}
                        {defaultBadgeState('vectordb') === 'overridden' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                            Overridden — global default will not cascade
                          </span>
                        )}
                        <button onClick={() => handleResetToDefault('vectordb')} disabled={savingConfig} className="text-xs text-blue-500 hover:text-blue-600 disabled:text-blue-300">
                          Reset to Global Default
                        </button>
                      </div>
                    )}
                    {botConfig?.vectordb?.is_default && botConfig?.global_default?.database?.databaseType && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Global default: {botConfig.global_default.database.databaseType}</p>
                    )}
                    {botConfigLoading ? (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                        <p className="text-sm text-slate-500">Loading...</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2 italic">
                          Number of Search Queries and Database Description are configured per-flow in the bot's flow builder; Global Default applies as a fallback.
                        </p>
                        <DatabaseCard
                          dbType={DB_TYPES.find(t => t.toLowerCase() === editVectordb.type) || ''}
                          onDbTypeChange={(displayType) => {
                            const lower = displayType.toLowerCase();
                            setEditVectordb(prev => ({
                              type: lower,
                              config: { ...prev.config, databaseType: lower },
                            }));
                            markDirty('vectordb_type');
                            markDirty('vectordb_config');
                          }}
                          showSharedFields={false}
                          {...(() => {
                            const props = {};
                            for (const [configKey, propName] of Object.entries(VDB_CONFIG_TO_PROP)) {
                              props[propName] = editVectordb.config[configKey] ?? '';
                              const onName = 'on' + propName[0].toUpperCase() + propName.slice(1) + 'Change';
                              props[onName] = (valOrEvent) => {
                                const val = valOrEvent?.target ? valOrEvent.target.value : valOrEvent;
                                setEditVectordb(prev => ({
                                  ...prev,
                                  config: { ...prev.config, [configKey]: val },
                                }));
                                markDirty('vectordb_config');
                              };
                            }
                            return props;
                          })()}
                        />
                        {/* Per-flow operational params: top_k + description
                            for each DB node. Edits land in flow.draft_json
                            (NOT Bot.vectordb_config). Save is consolidated
                            into the global "Save Config" button below. */}
                        {(flowConfig?.databases || []).length > 0 && (
                          <div className="mt-4">
                            <div className="flex items-center gap-1.5 mb-1">
                              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Per-Flow Operational Params
                              </h4>
                              <span
                                className="text-slate-400 dark:text-slate-500 cursor-help"
                                title="Edits land in flow.draft_json and merge into Bot.vectordb_config via cascade. The vectordb_default_overridden flag is unaffected by these fields."
                                aria-label="info"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                              Per-bot search count and database description. Empty values inherit Global Default.
                            </p>
                            <div className="space-y-0">
                              {(flowConfig.databases || []).map((db, i) => (
                                <div
                                  key={db.nodeId}
                                  className={i === 0 ? "py-3" : "py-3 border-t border-slate-100 dark:border-slate-800"}
                                >
                                  <DatabaseNodeOpsEditor
                                    label={_dbNodeLabel(db, flowConfig.databases)}
                                    value={editDbNodes[db.nodeId] || { topK: '', desc: '' }}
                                    onChange={(next) => setEditDbNodes((prev) => ({
                                      ...prev,
                                      [db.nodeId]: next,
                                    }))}
                                    error={dbNodeErrors[db.nodeId] || null}
                                    disabled={savingConfig}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Guardrails */}
                  {(flowConfig.guardrails || []).length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Guardrails</h3>
                      <div className="space-y-4">
                        {(flowConfig.guardrails || []).map((gr, i) => (
                          <div key={gr.nodeId || i} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                            <div className="space-y-0.5 mb-3">
                              <DetailRow label="Mode" value={gr.mode} />
                              <DetailRow label="Action" value={gr.actionOnTrigger} />
                              <DetailRow label="Blocked Message" value={gr.blockedMessage} />
                              {(gr.blockedKeywords || []).length > 0 && (
                                <DetailRow label="Blocked Keywords" value={gr.blockedKeywords.join(', ')} />
                              )}
                            </div>
                            {gr.instruction && (
                              <div>
                                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Instruction:</p>
                                <pre className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                  {gr.instruction}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tools */}
                  {(flowConfig.tools || []).length > 0 && (
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-6">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Tools</h3>
                      <div className="space-y-4">
                        {(flowConfig.tools || []).map((tool, i) => (
                          <div key={tool.nodeId || i} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400 mb-3">
                              {tool.label || 'MCP Tool'}
                            </span>
                            <div className="space-y-0.5">
                              <DetailRow label="Label" value={tool.label} />
                              <DetailRow label="Description" value={tool.description} />
                              <DetailRow label="URL" value={tool.url} />
                              <DetailRow label="Auth Type" value={tool.authType} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                >
                  {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {savingConfig ? 'Saving...' : 'Save Config'}
                </button>
                <button
                  onClick={handleSaveDetail}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
                >
                  SAVE STATUS
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal */}
      {showModal && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50"
            onClick={closeModal}
          ></div>
          
          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div 
              className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/50 dark:border-slate-800/50 w-full max-w-md pointer-events-auto animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  modalConfig.type === 'delete' 
                    ? 'bg-red-100 dark:bg-red-900/30' 
                    : modalConfig.type === 'activate'
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : 'bg-orange-100 dark:bg-orange-900/30'
                }`}>
                  <AlertTriangle className={`w-5 h-5 ${
                    modalConfig.type === 'delete' 
                      ? 'text-red-600 dark:text-red-400' 
                      : modalConfig.type === 'activate'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-orange-600 dark:text-orange-400'
                  }`} />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Confirm Action
                </h3>
                <button
                  onClick={closeModal}
                  className="ml-auto p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 py-4 space-y-3">
                <p className="text-slate-700 dark:text-slate-300">
                  {modalConfig.message}
                </p>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className={`px-4 py-2 text-white rounded-lg font-medium transition-colors ${
                    modalConfig.type === 'delete'
                      ? 'bg-red-600 hover:bg-red-700'
                      : modalConfig.type === 'activate'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-orange-600 hover:bg-orange-700'
                  }`}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Bot;
