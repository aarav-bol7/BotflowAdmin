import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Loader2, Brain, Mic, Database, AlertCircle, CheckCircle, Eye, EyeOff, CreditCard, Phone, Bell } from 'lucide-react';
import { flowService } from '../api/flowService';
import { botflowWs } from '../api/botflowWebSocket';
import GlobalDefaultAlerts from '../components/GlobalDefaultAlerts';
import toast from 'react-hot-toast';

// ─── Track D recovery (2026-04-23): self-save correlation tokens ──────────
// Client generates a UUID per save; server round-trips it in the broadcast
// payload. On match, the WS handler silently absorbs the echo and skips the
// collision banner. 10s TTL per critique #9 of the refined fix plan.
const SAVE_TOKEN_TTL_MS = 10_000;
const lastSaveTokens = new Map(); // eventName -> {token, expiresAt, sentFields}

function _generateSaveToken() {
  // crypto.randomUUID requires a secure context (HTTPS or localhost).
  // Fall back to a monotonic ID for plain-HTTP staging/dev.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* fall through */ }
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function _recordSaveToken(eventName, sentFields) {
  const token = _generateSaveToken();
  lastSaveTokens.set(eventName, {
    token,
    expiresAt: Date.now() + SAVE_TOKEN_TTL_MS,
    sentFields: Array.from(sentFields || []),
  });
  return token;
}

function _clearSaveToken(eventName) {
  lastSaveTokens.delete(eventName);
}

// Returns {sentFields} when the incoming payload is our own echo, else null.
function _matchSelfEcho(eventName, payload) {
  const incomingToken = payload && payload._save_token;
  if (!incomingToken) return null;
  const entry = lastSaveTokens.get(eventName);
  if (!entry) return null;
  if (entry.token !== incomingToken) return null;
  if (Date.now() > entry.expiresAt) return null;
  lastSaveTokens.delete(eventName);
  return { sentFields: entry.sentFields };
}

function GlobalDefault() {
  const [providers, setProviders] = useState([]);
  const [voiceProviders, setVoiceProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingModels, setSavingModels] = useState(false);
  const [savingLlmBilling, setSavingLlmBilling] = useState(false);
  const [savingVoiceBilling, setSavingVoiceBilling] = useState(false);

  // Chat defaults
  const [chatProviderKey, setChatProviderKey] = useState('');
  const [chatModelId, setChatModelId] = useState('');
  const [chatApiKey, setChatApiKey] = useState('');
  const [chatTemperature, setChatTemperature] = useState(null);

  // Voice defaults
  const [voiceProviderKey, setVoiceProviderKey] = useState('');
  const [voiceModelId, setVoiceModelId] = useState('');
  const [voiceApiKey, setVoiceApiKey] = useState('');
  const [voiceTemperature, setVoiceTemperature] = useState(null);
  // Realtime WS URL — required when provider_key === 'azure' (per-deployment),
  // optional override otherwise (backend falls back to provider template).
  const [voiceWebsocketUrl, setVoiceWebsocketUrl] = useState('');
  // Platform default voice persona. Empty string = "use the catalog
  // default_voice for the picked model" (seeded as a male voice).
  const [voiceName, setVoiceName] = useState('');

  // Database defaults
  const [dbType, setDbType] = useState('');
  const [dbHost, setDbHost] = useState('');
  const [dbPort, setDbPort] = useState('');
  const [dbName, setDbName] = useState('');
  const [dbUsername, setDbUsername] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [dbConnectionString, setDbConnectionString] = useState('');
  const [dbExpandQueryCount, setDbExpandQueryCount] = useState(4);
  const [dbToolDescription, setDbToolDescription] = useState('');
  const [dbSupabaseUrl, setDbSupabaseUrl] = useState('');
  const [dbSupabaseAnonKey, setDbSupabaseAnonKey] = useState('');
  const [dbSupabaseServiceRoleKey, setDbSupabaseServiceRoleKey] = useState('');
  const [dbVectorStoreName, setDbVectorStoreName] = useState('');
  const [dbVectorStoreId, setDbVectorStoreId] = useState('');
  // Pinecone defaults
  const [dbPineconeApiKey, setDbPineconeApiKey] = useState('');
  const [dbPineconeIndexName, setDbPineconeIndexName] = useState('');
  const [dbPineconeEnvironment, setDbPineconeEnvironment] = useState('');
  // Weaviate defaults
  const [dbWeaviateUrl, setDbWeaviateUrl] = useState('');
  const [dbWeaviateApiKey, setDbWeaviateApiKey] = useState('');
  const [dbWeaviateCollectionName, setDbWeaviateCollectionName] = useState('');
  // ChromaDB defaults
  const [dbChromaHost, setDbChromaHost] = useState('');
  const [dbChromaPort, setDbChromaPort] = useState('');
  const [dbChromaCollectionName, setDbChromaCollectionName] = useState('');
  // Milvus defaults
  const [dbMilvusUri, setDbMilvusUri] = useState('');
  const [dbMilvusToken, setDbMilvusToken] = useState('');
  const [dbMilvusCollectionName, setDbMilvusCollectionName] = useState('');
  // PGVector defaults
  const [dbPgvectorHost, setDbPgvectorHost] = useState('');
  const [dbPgvectorPort, setDbPgvectorPort] = useState('');
  const [dbPgvectorDatabase, setDbPgvectorDatabase] = useState('');
  const [dbPgvectorUsername, setDbPgvectorUsername] = useState('');
  const [dbPgvectorPassword, setDbPgvectorPassword] = useState('');
  const [dbPgvectorTableName, setDbPgvectorTableName] = useState('');
  const [savingDatabase, setSavingDatabase] = useState(false);

  // LLM Billing config
  const [llmBilling, setLlmBilling] = useState({
    is_enabled: false, minimum_balance: 0, warning_balance: 0, fail_open: true, max_failed_deductions: 10,
  });
  // Voice Billing config
  const [voiceBilling, setVoiceBilling] = useState({
    is_enabled: false, minimum_balance: 0, warning_balance: 0, fail_open: true, max_failed_deductions: 10,
  });

  // Notification defaults
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [savingNotifications, setSavingNotifications] = useState(false);

  // ─── WhatsApp voice-note transcription (STT — Voxtral/Mistral) ─────────
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [transcriptionApiKey, setTranscriptionApiKey] = useState('');
  const [showTranscriptionApiKey, setShowTranscriptionApiKey] = useState(false);
  const [savingTranscription, setSavingTranscription] = useState(false);

  // ─── Track D: cross-session sync state ─────────────────────────────────
  // lastLoaded* refs hold the last server-authoritative values. Diffing local
  // state vs these refs yields per-field dirty detection without instrumenting
  // every onChange handler. When a WS update event arrives, we split incoming
  // fields into "clean" (silent replace) and "conflict" (banner) by comparing
  // local=lastLoaded (clean) vs local!=lastLoaded (dirty).
  const lastLoadedDefaultsRef = useRef({ chat: {}, voice: {}, database: {}, notifications: {}, transcription: {} });
  const lastLoadedBillingRef = useRef({ llm: null, voice: null });
  const isInitialFetchPendingRef = useRef(true);
  const hasPendingEventRef = useRef(false);
  // NOTE (2026-07-09): the Track-D "Another admin updated these settings"
  // collision banner was removed — this is a single-admin deployment, so the
  // banner only ever fired on echoes of the admin's own saves. Conflicting
  // external updates now silently keep the LOCAL edit (clean fields still
  // live-update, self-echoes still absorb via _matchSelfEcho).

  // Refs so WS handlers always see latest local state for dirty detection.
  const localChatRef = useRef({});
  const localVoiceRef = useRef({});
  const localDbRef = useRef({});
  const localLlmBillingRef = useRef({});
  const localVoiceBillingRef = useRef({});
  const localNotificationsRef = useRef({});
  const localTranscriptionRef = useRef({});

  useEffect(() => {
    Promise.all([
      // Chat catalog — spec-shape endpoint. Lightweight: provider list only,
      // models load on-demand per provider via getChatModelsForProvider.
      flowService.getChatProviders().catch(() => ({ providers: [] })),
      flowService.getVoiceProviders().catch(() => []),
      flowService.getGlobalDefaults().catch(() => ({ chat: {}, voice: {} })),
      flowService.getBillingConfig().catch(() => null),
    ]).then(([chatProvidersPayload, voiceProviderList, defaults, billingConfig]) => {
      // Spec-shape: { providers: [{id, label, icon, supports_chat,
      // supports_realtime}] }. Massage into the {key, name, models[str]}
      // shape ModelCard already consumes — models stay empty until the
      // user picks a provider (lazy fetch).
      const chatProvidersList = Array.isArray(chatProvidersPayload?.providers)
        ? chatProvidersPayload.providers
        : [];
      const normalizedChat = chatProvidersList.map((p) => ({
        key: p.id,
        name: p.label || p.id,
        icon_url: p.icon || '',
        models: [], // lazy — populated by getChatModelsForProvider on select
      }));
      setProviders(normalizedChat);
      // Voice rows ship richer metadata (protocol, ws_base_url) but ModelCard
      // only consumes {key, name, models: [model_id]}. Normalize the model
      // entries down to model_id strings so the existing picker UI works
      // unchanged. ``protocol`` is appended to the display name so the
      // operator sees which wire format the runtime will speak.
      const normalizedVoice = (voiceProviderList || []).map((p) => ({
        key: p.key,
        name: p.protocol ? `${p.name} · ${p.protocol}` : p.name,
        icon_url: p.icon_url || '',
        // Preserve URL metadata so the voice ModelCard can pre-fill the
        // WS-URL placeholder and mark Azure as required.
        websocket_url_template: p.websocket_url_template || '',
        is_url_editable: !!p.is_url_editable,
        models: Array.isArray(p.models)
          ? p.models.map((m) => (typeof m === 'string' ? m : m.model_id))
          : [],
        // Per-model voice catalogs (voices + default_voice + voice_genders)
        // — keyed by model_id so the ModelCard can populate the voice
        // dropdown once a model is selected.
        modelVoices: Array.isArray(p.models)
          ? Object.fromEntries(p.models.map((m) => [
              typeof m === 'string' ? m : m.model_id,
              {
                voices: (typeof m === 'string' ? [] : (m.voices || [])),
                default_voice: (typeof m === 'string' ? '' : (m.default_voice || '')),
                voice_genders: (typeof m === 'string' ? {} : (m.voice_genders || {})),
              },
            ]))
          : {},
      }));
      setVoiceProviders(normalizedVoice);
      if (defaults.chat) {
        setChatProviderKey(defaults.chat.provider_key || '');
        setChatModelId(defaults.chat.model_id || '');
        setChatApiKey(defaults.chat.api_key || '');
        setChatTemperature(defaults.chat.temperature ?? null);
      }
      if (defaults.voice) {
        setVoiceProviderKey(defaults.voice.provider_key || '');
        setVoiceModelId(defaults.voice.model_id || '');
        setVoiceApiKey(defaults.voice.api_key || '');
        setVoiceTemperature(defaults.voice.temperature ?? null);
        setVoiceWebsocketUrl(defaults.voice.websocket_url || '');
        setVoiceName(defaults.voice.voice_name || '');
      }
      if (defaults.database) {
        const db = defaults.database;
        setDbType(db.db_type || '');
        setDbHost(db.db_host || '');
        setDbPort(db.db_port || '');
        setDbName(db.db_name || '');
        setDbUsername(db.db_username || '');
        setDbPassword(db.db_password || '');
        setDbConnectionString(db.db_connection_string || '');
        setDbExpandQueryCount(db.db_expand_query_count ?? 4);
        setDbToolDescription(db.db_tool_description || '');
        setDbSupabaseUrl(db.db_supabase_url || '');
        setDbSupabaseAnonKey(db.db_supabase_anon_key || '');
        setDbSupabaseServiceRoleKey(db.db_supabase_service_role_key || '');
        setDbVectorStoreName(db.db_vector_store_name || '');
        setDbVectorStoreId(db.db_vector_store_id || '');
        // Pinecone
        setDbPineconeApiKey(db.db_pinecone_api_key || '');
        setDbPineconeIndexName(db.db_pinecone_index_name || '');
        setDbPineconeEnvironment(db.db_pinecone_environment || '');
        // Weaviate
        setDbWeaviateUrl(db.db_weaviate_url || '');
        setDbWeaviateApiKey(db.db_weaviate_api_key || '');
        setDbWeaviateCollectionName(db.db_weaviate_collection_name || '');
        // ChromaDB
        setDbChromaHost(db.db_chroma_host || '');
        setDbChromaPort(db.db_chroma_port || '');
        setDbChromaCollectionName(db.db_chroma_collection_name || '');
        // Milvus
        setDbMilvusUri(db.db_milvus_uri || '');
        setDbMilvusToken(db.db_milvus_token || '');
        setDbMilvusCollectionName(db.db_milvus_collection_name || '');
        // PGVector
        setDbPgvectorHost(db.db_pgvector_host || '');
        setDbPgvectorPort(db.db_pgvector_port || '');
        setDbPgvectorDatabase(db.db_pgvector_database || '');
        setDbPgvectorUsername(db.db_pgvector_username || '');
        setDbPgvectorPassword(db.db_pgvector_password || '');
        setDbPgvectorTableName(db.db_pgvector_table_name || '');
      }
      if (defaults.notifications) {
        setNotificationsEnabled(defaults.notifications.notifications_enabled ?? true);
      }
      if (defaults.transcription) {
        setTranscriptionModel(defaults.transcription.model || '');
        setTranscriptionApiKey(defaults.transcription.api_key || '');
      }
      if (billingConfig) {
        if (billingConfig.llm) setLlmBilling(billingConfig.llm);
        if (billingConfig.voice) setVoiceBilling(billingConfig.voice);
      }
      // Track D: snapshot last-loaded values for dirty detection on WS events.
      lastLoadedDefaultsRef.current = {
        chat: (defaults && defaults.chat) || {},
        voice: (defaults && defaults.voice) || {},
        database: (defaults && defaults.database) || {},
        notifications: (defaults && defaults.notifications) || { notifications_enabled: true },
        transcription: (defaults && defaults.transcription) || {},
      };
      lastLoadedBillingRef.current = billingConfig || { llm: null, voice: null };
      setLoading(false);
      isInitialFetchPendingRef.current = false;
      // Replay any WS events that arrived during init.
      if (hasPendingEventRef.current) {
        hasPendingEventRef.current = false;
        Promise.all([
          flowService.getGlobalDefaults().catch(() => null),
          flowService.getBillingConfig().catch(() => null),
        ]).then(([d, b]) => {
          if (d) handleDefaultsUpdateRef.current?.(d);
          if (b) handleBillingUpdateRef.current?.(b);
        });
      }
    });
  }, []);

  // ─── Track D: ref sync for dirty detection ─────────────────────────────
  useEffect(() => {
    localChatRef.current = {
      provider_key: chatProviderKey,
      model_id: chatModelId,
      api_key: chatApiKey,
      temperature: chatTemperature,
    };
  }, [chatProviderKey, chatModelId, chatApiKey, chatTemperature]);
  useEffect(() => {
    localVoiceRef.current = {
      provider_key: voiceProviderKey,
      model_id: voiceModelId,
      api_key: voiceApiKey,
      temperature: voiceTemperature,
      websocket_url: voiceWebsocketUrl,
      voice_name: voiceName,
    };
  }, [voiceProviderKey, voiceModelId, voiceApiKey, voiceTemperature, voiceWebsocketUrl, voiceName]);
  useEffect(() => { localLlmBillingRef.current = llmBilling; }, [llmBilling]);
  useEffect(() => { localVoiceBillingRef.current = voiceBilling; }, [voiceBilling]);
  useEffect(() => {
    localNotificationsRef.current = { notifications_enabled: notificationsEnabled };
  }, [notificationsEnabled]);
  useEffect(() => {
    localTranscriptionRef.current = { model: transcriptionModel, api_key: transcriptionApiKey };
  }, [transcriptionModel, transcriptionApiKey]);

  // ─── Track D: merge handlers for WS config-updated events ──────────────
  // Algorithm (refined plan §7.4):
  //   For each incoming field:
  //     - current == lastLoaded  → clean; silent replace + update lastLoaded.
  //     - current == incoming    → self-echo; update lastLoaded only.
  //     - else                    → conflict; add to externalChanges banner.
  const _isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const _mergeSection = useCallback((sectionKey, incoming, lastLoaded, localSnapshot, setters) => {
    const conflicts = {};
    const incomingKeys = Object.keys(incoming || {});
    incomingKeys.forEach((k) => {
      const inc = incoming[k];
      const old = lastLoaded[k];
      const cur = localSnapshot[k];
      if (_isEqual(cur, old)) {
        // Clean → silent replace
        if (setters[k]) setters[k](inc);
        lastLoaded[k] = inc;
      } else if (_isEqual(cur, inc)) {
        // Self-echo → baseline update only
        lastLoaded[k] = inc;
      } else {
        // Conflict
        conflicts[k] = { incomingValue: inc, sectionKey };
      }
    });
    return conflicts;
  }, []);

  const handleDefaultsUpdate = useCallback((payload) => {
    if (isInitialFetchPendingRef.current) { hasPendingEventRef.current = true; return; }
    // Track D recovery: own-save echo → silently update baseline for sections
    // we sent, skip banner. Other sections (including concurrent external
    // changes outside our save scope) still flow through _mergeSection.
    const echo = _matchSelfEcho('global.defaults_updated', payload);
    if (echo) {
      const sent = new Set(echo.sentFields || []);
      if (sent.has('chat') && payload.chat) {
        lastLoadedDefaultsRef.current.chat = { ...payload.chat };
      }
      if (sent.has('voice') && payload.voice) {
        lastLoadedDefaultsRef.current.voice = { ...payload.voice };
      }
      if (sent.has('database') && payload.database) {
        lastLoadedDefaultsRef.current.database = { ...payload.database };
      }
      if (sent.has('notifications') && payload.notifications) {
        lastLoadedDefaultsRef.current.notifications = { ...payload.notifications };
      }
      if (sent.has('transcription') && payload.transcription) {
        lastLoadedDefaultsRef.current.transcription = { ...payload.transcription };
      }
      return;
    }
    const allConflicts = {};
    // Chat section
    Object.assign(allConflicts, _mergeSection(
      'chat',
      payload.chat || {},
      lastLoadedDefaultsRef.current.chat,
      localChatRef.current,
      {
        provider_key: setChatProviderKey,
        model_id: setChatModelId,
        api_key: setChatApiKey,
        temperature: setChatTemperature,
      },
    ));
    // Voice section
    Object.assign(allConflicts, _mergeSection(
      'voice',
      payload.voice || {},
      lastLoadedDefaultsRef.current.voice,
      localVoiceRef.current,
      {
        provider_key: setVoiceProviderKey,
        model_id: setVoiceModelId,
        api_key: setVoiceApiKey,
        temperature: setVoiceTemperature,
        websocket_url: setVoiceWebsocketUrl,
        voice_name: setVoiceName,
      },
    ));
    // Notifications
    Object.assign(allConflicts, _mergeSection(
      'notifications',
      payload.notifications || {},
      lastLoadedDefaultsRef.current.notifications,
      localNotificationsRef.current,
      { notifications_enabled: setNotificationsEnabled },
    ));
    // Transcription (STT)
    Object.assign(allConflicts, _mergeSection(
      'transcription',
      payload.transcription || {},
      lastLoadedDefaultsRef.current.transcription,
      localTranscriptionRef.current,
      { model: setTranscriptionModel, api_key: setTranscriptionApiKey },
    ));
    // Database: too many fields to enumerate setters; treat as opaque "section".
    // If local == lastLoaded for all db fields, silent replace all. Otherwise banner-only.
    if (payload.database && Object.keys(payload.database).length > 0) {
      const anyDirty = Object.keys(payload.database).some(
        (k) => !_isEqual(localDbRef.current[k], lastLoadedDefaultsRef.current.database[k]),
      );
      const anyChanged = Object.keys(payload.database).some(
        (k) => !_isEqual(payload.database[k], lastLoadedDefaultsRef.current.database[k]),
      );
      if (anyChanged && anyDirty) {
        allConflicts['database (any field)'] = { incomingValue: payload.database, sectionKey: 'database' };
      } else if (anyChanged) {
        // Apply all db fields silently via a small router
        applyDatabasePayload(payload.database);
        lastLoadedDefaultsRef.current.database = { ...payload.database };
      }
    }
    // Conflicts (local dirty + external change) keep the LOCAL edit silently —
    // banner removed for the single-admin deployment.
    void allConflicts;
  }, [_mergeSection]);

  const handleBillingUpdate = useCallback((payload) => {
    if (isInitialFetchPendingRef.current) { hasPendingEventRef.current = true; return; }
    // Track D recovery: own-save echo → scoped baseline update for sent
    // section (llm or voice); other section still flows through _mergeSection.
    const echo = _matchSelfEcho('billing.config_updated', payload);
    if (echo) {
      const sent = new Set(echo.sentFields || []);
      if (!lastLoadedBillingRef.current) lastLoadedBillingRef.current = {};
      if (sent.has('llm') && payload.llm) {
        lastLoadedBillingRef.current.llm = { ...payload.llm };
      }
      if (sent.has('voice') && payload.voice) {
        lastLoadedBillingRef.current.voice = { ...payload.voice };
      }
      return;
    }
    const conflicts = {};
    ['llm', 'voice'].forEach((section) => {
      const inc = payload[section] || {};
      const old = (lastLoadedBillingRef.current && lastLoadedBillingRef.current[section]) || {};
      const cur = section === 'llm' ? localLlmBillingRef.current : localVoiceBillingRef.current;
      const curDirty = !_isEqual(cur, old);
      const incChanged = !_isEqual(inc, old);
      if (incChanged && curDirty) {
        conflicts[`billing.${section}`] = { incomingValue: inc, sectionKey: `billing.${section}` };
      } else if (incChanged) {
        if (section === 'llm') setLlmBilling(inc); else setVoiceBilling(inc);
        if (!lastLoadedBillingRef.current) lastLoadedBillingRef.current = {};
        lastLoadedBillingRef.current[section] = { ...inc };
      }
    });
    // Conflicts keep the LOCAL edit silently — banner removed (single admin).
    void conflicts;
  }, []);

  // Stash handlers in refs so the init-replay path can invoke them.
  const handleDefaultsUpdateRef = useRef(handleDefaultsUpdate);
  const handleBillingUpdateRef = useRef(handleBillingUpdate);
  useEffect(() => { handleDefaultsUpdateRef.current = handleDefaultsUpdate; }, [handleDefaultsUpdate]);
  useEffect(() => { handleBillingUpdateRef.current = handleBillingUpdate; }, [handleBillingUpdate]);

  // ─── Track D: WebSocket subscriptions ──────────────────────────────────
  useEffect(() => {
    botflowWs.connect();
    // connected/disconnected subscribed for WS lifecycle completeness; the
    // reconnected handler below is what drives post-gap refetch.
    const offConnected = botflowWs.on('connected', () => {});
    const offDisconnected = botflowWs.on('disconnected', () => {});
    const offReconnected = botflowWs.on('reconnected', () => {
      // Full refetch on reconnect; dirty-aware merge preserves local edits.
      Promise.all([
        flowService.getGlobalDefaults().catch(() => null),
        flowService.getBillingConfig().catch(() => null),
      ]).then(([d, b]) => {
        if (d) handleDefaultsUpdateRef.current(d);
        if (b) handleBillingUpdateRef.current(b);
      });
    });
    const offDefaults = botflowWs.on('global.defaults_updated', (p) => handleDefaultsUpdateRef.current(p));
    const offBilling = botflowWs.on('billing.config_updated', (p) => handleBillingUpdateRef.current(p));
    return () => {
      offConnected(); offDisconnected(); offReconnected();
      offDefaults(); offBilling();
      botflowWs.disconnect();
    };
  }, []);

  // Helper to apply a database payload via individual setters.
  function applyDatabasePayload(db) {
    if ('db_type' in db) setDbType(db.db_type || '');
    if ('db_host' in db) setDbHost(db.db_host || '');
    if ('db_port' in db) setDbPort(db.db_port || '');
    if ('db_name' in db) setDbName(db.db_name || '');
    if ('db_username' in db) setDbUsername(db.db_username || '');
    if ('db_password' in db) setDbPassword(db.db_password || '');
    if ('db_connection_string' in db) setDbConnectionString(db.db_connection_string || '');
    if ('db_expand_query_count' in db) setDbExpandQueryCount(db.db_expand_query_count ?? 4);
    if ('db_tool_description' in db) setDbToolDescription(db.db_tool_description || '');
    if ('db_supabase_url' in db) setDbSupabaseUrl(db.db_supabase_url || '');
    if ('db_supabase_anon_key' in db) setDbSupabaseAnonKey(db.db_supabase_anon_key || '');
    if ('db_supabase_service_role_key' in db) setDbSupabaseServiceRoleKey(db.db_supabase_service_role_key || '');
    if ('db_vector_store_name' in db) setDbVectorStoreName(db.db_vector_store_name || '');
    if ('db_vector_store_id' in db) setDbVectorStoreId(db.db_vector_store_id || '');
    if ('db_pinecone_api_key' in db) setDbPineconeApiKey(db.db_pinecone_api_key || '');
    if ('db_pinecone_index_name' in db) setDbPineconeIndexName(db.db_pinecone_index_name || '');
    if ('db_pinecone_environment' in db) setDbPineconeEnvironment(db.db_pinecone_environment || '');
    if ('db_weaviate_url' in db) setDbWeaviateUrl(db.db_weaviate_url || '');
    if ('db_weaviate_api_key' in db) setDbWeaviateApiKey(db.db_weaviate_api_key || '');
    if ('db_weaviate_collection_name' in db) setDbWeaviateCollectionName(db.db_weaviate_collection_name || '');
    if ('db_chroma_host' in db) setDbChromaHost(db.db_chroma_host || '');
    if ('db_chroma_port' in db) setDbChromaPort(db.db_chroma_port || '');
    if ('db_chroma_collection_name' in db) setDbChromaCollectionName(db.db_chroma_collection_name || '');
    if ('db_milvus_uri' in db) setDbMilvusUri(db.db_milvus_uri || '');
    if ('db_milvus_token' in db) setDbMilvusToken(db.db_milvus_token || '');
    if ('db_milvus_collection_name' in db) setDbMilvusCollectionName(db.db_milvus_collection_name || '');
    if ('db_pgvector_host' in db) setDbPgvectorHost(db.db_pgvector_host || '');
    if ('db_pgvector_port' in db) setDbPgvectorPort(db.db_pgvector_port || '');
    if ('db_pgvector_database' in db) setDbPgvectorDatabase(db.db_pgvector_database || '');
    if ('db_pgvector_username' in db) setDbPgvectorUsername(db.db_pgvector_username || '');
    if ('db_pgvector_password' in db) setDbPgvectorPassword(db.db_pgvector_password || '');
    if ('db_pgvector_table_name' in db) setDbPgvectorTableName(db.db_pgvector_table_name || '');
  }

  const getModelsForProvider = (providerKey) => {
    const p = providers.find((pr) => pr.key === providerKey);
    return p ? p.models : [];
  };

  const getVoiceModelsForProvider = (providerKey) => {
    const p = voiceProviders.find((pr) => pr.key === providerKey);
    return p ? p.models : [];
  };

  // Lazy per-provider chat-model fetch. Triggered when the operator picks
  // a chat provider; result mutates the corresponding row in `providers`
  // so getModelsForProvider can find it. Already-loaded providers are
  // skipped (idempotent).
  const fetchChatModelsForProvider = useCallback((providerKey) => {
    if (!providerKey) return;
    setProviders((prev) => {
      const existing = prev.find((p) => p.key === providerKey);
      if (existing && Array.isArray(existing.models) && existing.models.length > 0) {
        return prev; // already cached
      }
      return prev;
    });
    flowService.getChatModelsForProvider(providerKey)
      .then((payload) => {
        const ids = Array.isArray(payload?.models)
          ? payload.models.map((m) => m.id || m).filter(Boolean)
          : [];
        setProviders((prev) => prev.map((p) =>
          p.key === providerKey ? { ...p, models: ids } : p,
        ));
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[GlobalDefault] chat models fetch failed for ${providerKey}:`, err);
      });
  }, []);

  const handleProviderChange = (type, key) => {
    if (type === 'chat') {
      setChatProviderKey(key);
      setChatModelId('');
      if (key) fetchChatModelsForProvider(key);
    } else {
      setVoiceProviderKey(key);
      setVoiceModelId('');
      // Voice catalogs are per-model. Clearing the model also invalidates
      // the picked voice (e.g. ``Charon`` from Gemini → not in OpenAI's
      // voice list). Leaving it would either: 400 at PUT (backend
      // membership guard) or persist a voice the realtime API rejects.
      setVoiceName('');
      // When switching to a fixed-URL provider (Grok/OpenAI/Gemini), the
      // stored override is irrelevant — the runtime falls back to the
      // provider template. Clear it so a stale Azure URL doesn't ride along.
      // For Azure (is_url_editable=true) the operator must (re-)enter their
      // per-deployment URL anyway, so clearing is also safer there.
      const next = (voiceProviders || []).find((p) => p.key === key);
      if (!next || !next.is_url_editable) {
        setVoiceWebsocketUrl('');
      }
    }
  };

  // Voice catalog for the picked (provider, model). Frontend reads this
  // to populate the voice dropdown.
  const _voiceCatalogForSelection = () => {
    const p = (voiceProviders || []).find((q) => q.key === voiceProviderKey);
    const entry = p?.modelVoices?.[voiceModelId];
    return {
      voices: entry?.voices || [],
      default_voice: entry?.default_voice || '',
      voice_genders: entry?.voice_genders || {},
    };
  };

  // Pre-fetch chat models for whatever provider GlobalDefault already
  // stores so the model dropdown is populated by the time the user
  // opens it. Skips when chat provider is empty.
  useEffect(() => {
    if (chatProviderKey) fetchChatModelsForProvider(chatProviderKey);
  }, [chatProviderKey, fetchChatModelsForProvider]);

  // Helper: is the currently-selected voice provider editable URL? Falls
  // back to the lowercase 'azure' heuristic when the catalog hasn't loaded.
  const _voiceProviderEditable = () => {
    const p = (voiceProviders || []).find((q) => q.key === voiceProviderKey);
    if (p) return !!p.is_url_editable;
    return (voiceProviderKey || '').toLowerCase() === 'azure';
  };
  const voiceUrlMissingForEditable = _voiceProviderEditable() && !(voiceWebsocketUrl || '').trim();

  const handleSaveModels = async () => {
    // Pre-save guard: Azure (or any other future is_url_editable=true
    // provider) MUST have a non-blank URL. Block client-side to avoid the
    // server-round-trip + toast pattern and to keep the rose-border flag
    // honest. Defense-in-depth: backend still 400s the same case.
    if (voiceUrlMissingForEditable) {
      toast.error('WebSocket URL is required for the selected voice provider.');
      return;
    }
    setSavingModels(true);
    // Track D recovery: correlate broadcast→self-save via token.
    // sentFields covers both chat and voice sub-dicts (section names, not leaf keys).
    const _token = _recordSaveToken('global.defaults_updated', ['chat', 'voice']);
    try {
      await flowService.updateGlobalDefaults({
        chat_provider_key: chatProviderKey,
        chat_model_id: chatModelId,
        chat_api_key: chatApiKey,
        chat_temperature: chatTemperature,
        voice_provider_key: voiceProviderKey,
        voice_model_id: voiceModelId,
        voice_api_key: voiceApiKey,
        voice_temperature: voiceTemperature,
        // For fixed-URL providers (OpenAI/Grok/Gemini) the displayed value
        // is the substituted template — what the operator sees is NOT what
        // is in state. Ship '' so the runtime falls back to the catalog
        // template; otherwise a stale Azure URL loaded into state would
        // ride along under a non-Azure provider and dial the wrong host.
        voice_websocket_url: _voiceProviderEditable() ? (voiceWebsocketUrl || '').trim() : '',
        voice_name: voiceName || '',
        _save_token: _token,
      });
      toast.success('Model defaults saved');
    } catch (err) {
      _clearSaveToken('global.defaults_updated');
      toast.error(err.message || 'Failed to save model defaults');
    } finally {
      setSavingModels(false);
    }
  };

  const handleSaveDatabase = async () => {
    setSavingDatabase(true);
    const _token = _recordSaveToken('global.defaults_updated', ['database']);
    try {
      await flowService.updateGlobalDefaults({
        _save_token: _token,
        db_type: dbType,
        db_host: dbHost,
        db_port: dbPort,
        db_name: dbName,
        db_username: dbUsername,
        db_password: dbPassword,
        db_connection_string: dbConnectionString,
        db_expand_query_count: dbExpandQueryCount,
        db_tool_description: dbToolDescription,
        db_supabase_url: dbSupabaseUrl,
        db_supabase_anon_key: dbSupabaseAnonKey,
        db_supabase_service_role_key: dbSupabaseServiceRoleKey,
        db_vector_store_name: dbVectorStoreName,
        db_vector_store_id: dbVectorStoreId,
        db_pinecone_api_key: dbPineconeApiKey,
        db_pinecone_index_name: dbPineconeIndexName,
        db_pinecone_environment: dbPineconeEnvironment,
        db_weaviate_url: dbWeaviateUrl,
        db_weaviate_api_key: dbWeaviateApiKey,
        db_weaviate_collection_name: dbWeaviateCollectionName,
        db_chroma_host: dbChromaHost,
        db_chroma_port: dbChromaPort,
        db_chroma_collection_name: dbChromaCollectionName,
        db_milvus_uri: dbMilvusUri,
        db_milvus_token: dbMilvusToken,
        db_milvus_collection_name: dbMilvusCollectionName,
        db_pgvector_host: dbPgvectorHost,
        db_pgvector_port: dbPgvectorPort,
        db_pgvector_database: dbPgvectorDatabase,
        db_pgvector_username: dbPgvectorUsername,
        db_pgvector_password: dbPgvectorPassword,
        db_pgvector_table_name: dbPgvectorTableName,
      });
      toast.success('Database defaults saved');
    } catch (err) {
      _clearSaveToken('global.defaults_updated');
      toast.error(err.message || 'Failed to save database defaults');
    } finally {
      setSavingDatabase(false);
    }
  };

  const handleSaveLlmBilling = async () => {
    setSavingLlmBilling(true);
    const _token = _recordSaveToken('billing.config_updated', ['llm']);
    try {
      await flowService.updateBillingConfig({ llm: llmBilling, _save_token: _token });
      toast.success('LLM billing config saved');
    } catch (err) {
      _clearSaveToken('billing.config_updated');
      toast.error(err.message || 'Failed to save LLM billing config');
    } finally {
      setSavingLlmBilling(false);
    }
  };

  const handleSaveVoiceBilling = async () => {
    setSavingVoiceBilling(true);
    const _token = _recordSaveToken('billing.config_updated', ['voice']);
    try {
      await flowService.updateBillingConfig({ voice: voiceBilling, _save_token: _token });
      toast.success('Voice billing config saved');
    } catch (err) {
      _clearSaveToken('billing.config_updated');
      toast.error(err.message || 'Failed to save voice billing config');
    } finally {
      setSavingVoiceBilling(false);
    }
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    const _token = _recordSaveToken('global.defaults_updated', ['notifications']);
    try {
      await flowService.updateGlobalDefaults({
        notifications_enabled: notificationsEnabled,
        _save_token: _token,
      });
      toast.success('Notification settings saved');
    } catch (err) {
      _clearSaveToken('global.defaults_updated');
      toast.error(err.message || 'Failed to save notification settings');
    } finally {
      setSavingNotifications(false);
    }
  };

  const handleSaveTranscription = async () => {
    setSavingTranscription(true);
    const _token = _recordSaveToken('global.defaults_updated', ['transcription']);
    try {
      await flowService.updateGlobalDefaults({
        transcription_model: (transcriptionModel || '').trim(),
        transcription_api_key: (transcriptionApiKey || '').trim(),
        _save_token: _token,
      });
      toast.success('Transcription settings saved');
    } catch (err) {
      _clearSaveToken('global.defaults_updated');
      toast.error(err.message || 'Failed to save transcription settings');
    } finally {
      setSavingTranscription(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50">
        <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          These defaults are used when a flow&apos;s Chat Model node is set to <strong>Default</strong> provider.
        </p>
      </div>

      {/* Platform-level failures of the defaults configured below (expired
          key, dead model, quota) — same rows as the header bell, in full. */}
      <GlobalDefaultAlerts />

      {/* Two cards in a row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chat Model Default */}
        <ModelCard
          title="Chat Model (LLM)"
          description="Default model for text/chat interactions"
          icon={Brain}
          iconColor="text-blue-500"
          bgColor="bg-blue-500/10"
          borderAccent="border-t-blue-500"
          providers={providers}
          providerKey={chatProviderKey}
          modelId={chatModelId}
          apiKey={chatApiKey}
          temperature={chatTemperature}
          onProviderChange={(key) => handleProviderChange('chat', key)}
          onModelChange={setChatModelId}
          onApiKeyChange={setChatApiKey}
          onTemperatureChange={setChatTemperature}
          getModels={getModelsForProvider}
        />

        {/* Voice Model Default */}
        <ModelCard
          title="Voice Model (LLM)"
          description="Default model for voice/realtime interactions (admin-managed catalog)"
          icon={Mic}
          iconColor="text-purple-500"
          bgColor="bg-purple-500/10"
          borderAccent="border-t-purple-500"
          providers={voiceProviders}
          providerKey={voiceProviderKey}
          modelId={voiceModelId}
          apiKey={voiceApiKey}
          temperature={voiceTemperature}
          websocketUrl={voiceWebsocketUrl}
          voiceName={voiceName}
          voiceCatalog={_voiceCatalogForSelection()}
          onProviderChange={(key) => handleProviderChange('voice', key)}
          onModelChange={(modelId) => { setVoiceModelId(modelId); setVoiceName(''); }}
          onApiKeyChange={setVoiceApiKey}
          onTemperatureChange={setVoiceTemperature}
          onWebsocketUrlChange={setVoiceWebsocketUrl}
          onVoiceNameChange={setVoiceName}
          getModels={getVoiceModelsForProvider}
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={handleSaveModels}
          disabled={savingModels || voiceUrlMissingForEditable}
          title={voiceUrlMissingForEditable ? 'Set the per-deployment WebSocket URL before saving.' : ''}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {savingModels ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {savingModels ? 'Saving...' : 'Save Model Defaults'}
        </button>
      </div>

      {/* Credit Limit Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BillingConfigCard
          title="LLM Credit Limits"
          description="Control billing thresholds for text/chat interactions"
          icon={CreditCard}
          iconColor="text-emerald-500"
          bgColor="bg-emerald-500/10"
          borderAccent="border-t-emerald-500"
          config={llmBilling}
          onChange={setLlmBilling}
          onSave={handleSaveLlmBilling}
          saving={savingLlmBilling}
        />
        <BillingConfigCard
          title="Voice Credit Limits"
          description="Control billing thresholds for voice call interactions"
          icon={Phone}
          iconColor="text-rose-500"
          bgColor="bg-rose-500/10"
          borderAccent="border-t-rose-500"
          config={voiceBilling}
          onChange={setVoiceBilling}
          onSave={handleSaveVoiceBilling}
          saving={savingVoiceBilling}
        />
      </div>

      {/* Database Default */}
      <DatabaseCard
        dbType={dbType} onDbTypeChange={setDbType}
        dbHost={dbHost} onDbHostChange={setDbHost}
        dbPort={dbPort} onDbPortChange={setDbPort}
        dbName={dbName} onDbNameChange={setDbName}
        dbUsername={dbUsername} onDbUsernameChange={setDbUsername}
        dbPassword={dbPassword} onDbPasswordChange={setDbPassword}
        dbConnectionString={dbConnectionString} onDbConnectionStringChange={setDbConnectionString}
        dbExpandQueryCount={dbExpandQueryCount} onDbExpandQueryCountChange={setDbExpandQueryCount}
        dbToolDescription={dbToolDescription} onDbToolDescriptionChange={setDbToolDescription}
        dbSupabaseUrl={dbSupabaseUrl} onDbSupabaseUrlChange={setDbSupabaseUrl}
        dbSupabaseAnonKey={dbSupabaseAnonKey} onDbSupabaseAnonKeyChange={setDbSupabaseAnonKey}
        dbSupabaseServiceRoleKey={dbSupabaseServiceRoleKey} onDbSupabaseServiceRoleKeyChange={setDbSupabaseServiceRoleKey}
        dbVectorStoreName={dbVectorStoreName} onDbVectorStoreNameChange={setDbVectorStoreName}
        dbVectorStoreId={dbVectorStoreId} onDbVectorStoreIdChange={setDbVectorStoreId}
        dbPineconeApiKey={dbPineconeApiKey} onDbPineconeApiKeyChange={setDbPineconeApiKey}
        dbPineconeIndexName={dbPineconeIndexName} onDbPineconeIndexNameChange={setDbPineconeIndexName}
        dbPineconeEnvironment={dbPineconeEnvironment} onDbPineconeEnvironmentChange={setDbPineconeEnvironment}
        dbWeaviateUrl={dbWeaviateUrl} onDbWeaviateUrlChange={setDbWeaviateUrl}
        dbWeaviateApiKey={dbWeaviateApiKey} onDbWeaviateApiKeyChange={setDbWeaviateApiKey}
        dbWeaviateCollectionName={dbWeaviateCollectionName} onDbWeaviateCollectionNameChange={setDbWeaviateCollectionName}
        dbChromaHost={dbChromaHost} onDbChromaHostChange={setDbChromaHost}
        dbChromaPort={dbChromaPort} onDbChromaPortChange={setDbChromaPort}
        dbChromaCollectionName={dbChromaCollectionName} onDbChromaCollectionNameChange={setDbChromaCollectionName}
        dbMilvusUri={dbMilvusUri} onDbMilvusUriChange={setDbMilvusUri}
        dbMilvusToken={dbMilvusToken} onDbMilvusTokenChange={setDbMilvusToken}
        dbMilvusCollectionName={dbMilvusCollectionName} onDbMilvusCollectionNameChange={setDbMilvusCollectionName}
        dbPgvectorHost={dbPgvectorHost} onDbPgvectorHostChange={setDbPgvectorHost}
        dbPgvectorPort={dbPgvectorPort} onDbPgvectorPortChange={setDbPgvectorPort}
        dbPgvectorDatabase={dbPgvectorDatabase} onDbPgvectorDatabaseChange={setDbPgvectorDatabase}
        dbPgvectorUsername={dbPgvectorUsername} onDbPgvectorUsernameChange={setDbPgvectorUsername}
        dbPgvectorPassword={dbPgvectorPassword} onDbPgvectorPasswordChange={setDbPgvectorPassword}
        dbPgvectorTableName={dbPgvectorTableName} onDbPgvectorTableNameChange={setDbPgvectorTableName}
        onSave={handleSaveDatabase}
        saving={savingDatabase}
      />

      {/* External Notifications */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-t-4 border-slate-200 dark:border-slate-800 border-t-amber-500 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Bell className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">External Notifications</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Control WhatsApp and email notification delivery globally</p>
          </div>
        </div>
        <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Enable external notifications</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">When disabled, no WhatsApp or email notifications will be sent to any tenant</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notificationsEnabled}
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${notificationsEnabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={handleSaveNotifications} disabled={savingNotifications} className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-lg text-sm font-medium transition-colors">
            {savingNotifications ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingNotifications ? 'Saving...' : 'Save Notification Settings'}
          </button>
        </div>
      </div>

      {/* WhatsApp Voice-note Transcription (STT) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-t-4 border-slate-200 dark:border-slate-800 border-t-amber-500 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Mic className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Voice-note Transcription</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Transcribes inbound WhatsApp voice notes to text (Voxtral / Mistral). Leave the API key blank to disable — voice notes then ask the user to type instead.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Model</label>
            <input
              type="text"
              value={transcriptionModel}
              onChange={(e) => setTranscriptionModel(e.target.value)}
              placeholder="voxtral-mini-2602"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showTranscriptionApiKey ? 'text' : 'password'}
                value={transcriptionApiKey}
                onChange={(e) => setTranscriptionApiKey(e.target.value)}
                placeholder="Voxtral / Mistral API key"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="button"
                onClick={() => setShowTranscriptionApiKey(!showTranscriptionApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showTranscriptionApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={handleSaveTranscription} disabled={savingTranscription} className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-lg text-sm font-medium transition-colors">
            {savingTranscription ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingTranscription ? 'Saving...' : 'Save Transcription Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Custom dropdown with a hard-capped popup height (native <select> popups
// are browser-controlled and ignore CSS height). Closes on outside click,
// supports an inline search input, and falls back to rendering the
// current value as a "ghost" row when it isn't in the option list (so
// saved legacy values stay visible).
function CappedDropdown({
  value, options, onChange, placeholder = 'Select', disabled = false,
  maxHeight = 240, searchPlaceholder = 'Search…',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  const selected = (options || []).find((o) => o.key === value);
  const label = selected?.name || (value && !selected ? value : placeholder);
  const q = search.trim().toLowerCase();
  const filtered = q
    ? (options || []).filter((o) =>
        (o.key || '').toLowerCase().includes(q)
        || (o.name || '').toLowerCase().includes(q),
      )
    : (options || []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent flex items-center justify-between text-left"
      >
        <span className={selected || value ? '' : 'text-slate-400'}>{label}</span>
        <svg className={`w-4 h-4 ml-2 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg flex flex-col"
          style={{ maxHeight }}
        >
          {(options || []).length > 8 && (
            <div className="p-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-shrink-0">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 ${!value ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''}`}
            >
              {placeholder}
            </button>
            {value && !selected && (
              // Saved value not in current option list — surface it as a
              // ghost row so the operator can re-select / replace it.
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full text-left px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 italic"
              >
                {value} <span className="text-[10px] not-italic">(current, not in catalog)</span>
              </button>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs text-slate-400 dark:text-slate-500 text-center">
                {q ? `No matches for “${search}”` : 'No options available'}
              </div>
            )}
            {filtered.map((o) => (
              <button
                type="button"
                key={o.key}
                onClick={() => { onChange(o.key); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${o.key === value ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-white'}`}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelCard({ title, description, icon: Icon, iconColor, bgColor, borderAccent, providers, providerKey, modelId, apiKey, temperature, websocketUrl, voiceName, voiceCatalog, onProviderChange, onModelChange, onApiKeyChange, onTemperatureChange, onWebsocketUrlChange, onVoiceNameChange, getModels }) {
  const models = getModels(providerKey);
  const hasSelection = providerKey && modelId;
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  // Voice-only WS URL state. Only the voice card passes onWebsocketUrlChange,
  // so this whole block is dead-weight for the chat card.
  const showWsUrl = typeof onWebsocketUrlChange === 'function';
  const selectedProvider = providers.find((p) => p.key === providerKey) || null;
  const wsTemplate = selectedProvider?.websocket_url_template || '';
  // Provider catalog drives editability — Azure flags itself via
  // ``is_url_editable=true``; OpenAI/Grok/Gemini ship as ``false``. Falling
  // back to the legacy "key === 'azure'" check keeps things working if a
  // provider row is misconfigured.
  const wsIsEditable = selectedProvider
    ? !!selectedProvider.is_url_editable
    : ((providerKey || '').toLowerCase() === 'azure');
  // Substitute {model} ONLY when both pieces are present. If a fixed-URL
  // provider is picked but no model yet, render the field empty with a
  // "pick a model" hint instead of leaking the literal "{model}" token
  // (which looks like a bug to anyone unfamiliar with the template).
  const wsRenderedTemplate = wsTemplate && modelId
    ? wsTemplate.replace('{model}', modelId)
    : '';
  // For fixed-URL providers we show the resolved template as the (read-only)
  // value so the operator sees exactly which endpoint the runtime will use.
  // For editable providers (Azure) we show their stored override, with a
  // helpful placeholder when blank.
  const wsDisplayValue = wsIsEditable
    ? (websocketUrl || '')
    : wsRenderedTemplate;
  // Catalog misconfig: provider says fixed-URL but template is blank
  // (e.g. Gemini until its runtime is implemented). Loud-fail in the UI
  // so the operator doesn't save a config that 1006s at call time.
  const wsFixedButNoTemplate = !wsIsEditable && !!selectedProvider && !wsTemplate;
  // For an editable provider we prefer the catalog template as the
  // placeholder if it has one (hypothetical non-Azure editable provider),
  // falling back to the Azure-style example otherwise.
  const wsPlaceholder = wsIsEditable
    ? (wsTemplate || 'wss://<your-resource>.openai.azure.com/openai/realtime?api-version=…&deployment=…')
    : wsFixedButNoTemplate
      ? 'This provider has no WebSocket URL configured in the catalog — runtime will fail.'
      : (wsRenderedTemplate
          || (selectedProvider
              ? 'Pick a model to see the resolved URL'
              : 'Pick a provider to see its fixed URL'));
  const wsMissingForEditable = wsIsEditable && !((websocketUrl || '').trim());

  // Voice dropdown is voice-card-only — chat card never passes
  // onVoiceNameChange so this whole block compiles out for chat.
  const showVoiceField = typeof onVoiceNameChange === 'function';
  const voices = (voiceCatalog && voiceCatalog.voices) || [];
  const catalogDefaultVoice = (voiceCatalog && voiceCatalog.default_voice) || '';
  // What the runtime will dial if voiceName is left blank — useful to
  // show as a hint, so the admin knows the bot defaults to ash/Rex/Charon
  // when they don't pick anything.
  const resolvedVoice = voiceName || catalogDefaultVoice;

  const providerQ = providerSearch.trim().toLowerCase();
  const filteredProviders = providerQ
    ? providers.filter((p) =>
        (p.key || '').toLowerCase().includes(providerQ)
        || (p.name || '').toLowerCase().includes(providerQ),
      )
    : providers;

  const modelQ = modelSearch.trim().toLowerCase();
  const filteredModels = modelQ
    ? models.filter((m) => (m || '').toLowerCase().includes(modelQ))
    : models;

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 border-t-4 ${borderAccent} p-6 flex flex-col`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className={`p-2.5 rounded-lg ${bgColor}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {hasSelection && (
          <CheckCircle className="w-4 h-4 text-emerald-500" />
        )}
      </div>

      {/* Fields */}
      <div className="space-y-4 flex-1">
        {/* Provider */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
            <span>Provider</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
              {providers.length} available
            </span>
          </label>
          {/* Filter input — critical when the chat catalog is ~143 providers
              from models.dev. Empty input keeps the full <select> visible. */}
          {/* Popup height is hard-capped via maxHeight so the dropdown
              doesn't blow up vertically even with 143 chat providers. */}
          <CappedDropdown
            value={providerKey}
            options={providers.map((p) => ({ key: p.key, name: p.name }))}
            onChange={onProviderChange}
            placeholder="Select provider"
            searchPlaceholder="Search providers…"
            maxHeight={260}
          />
          {providers.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              No providers loaded — check the /api/llm/{title.toLowerCase().includes('voice') ? 'voice-models' : 'providers'}/ endpoint.
            </p>
          )}
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
            <span>Model</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
              {providerKey ? `${models.length} for ${providerKey}` : '—'}
            </span>
          </label>
          <CappedDropdown
            value={modelId}
            options={models.map((m) => ({ key: m, name: m }))}
            onChange={onModelChange}
            placeholder={providerKey ? 'Select model' : 'Pick a provider first'}
            searchPlaceholder="Search models…"
            disabled={!providerKey}
            maxHeight={260}
          />
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            API Key
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Enter API Key"
              className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* WebSocket URL (voice only) — editable + required for Azure, read-only for fixed providers */}
        {showWsUrl && (
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span>
                WebSocket URL
                {wsIsEditable && (
                  <span className="ml-1 text-rose-500" title="Required for this provider">*</span>
                )}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                {wsIsEditable ? 'per-deployment' : 'fixed by provider'}
              </span>
            </label>
            <input
              type="text"
              value={wsDisplayValue}
              onChange={(e) => wsIsEditable && onWebsocketUrlChange(e.target.value)}
              placeholder={wsPlaceholder}
              readOnly={!wsIsEditable}
              aria-readonly={!wsIsEditable}
              title={
                wsIsEditable
                  ? ''
                  : wsFixedButNoTemplate
                    ? 'This provider has no WebSocket URL in the catalog.'
                    : 'Fixed by provider — selecting the model is enough.'
              }
              className={`w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                !wsIsEditable
                  ? (wsFixedButNoTemplate
                      ? 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 cursor-not-allowed border-rose-400 dark:border-rose-500'
                      : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 cursor-not-allowed border-slate-200 dark:border-slate-700')
                  : wsMissingForEditable
                    ? 'border-rose-400 dark:border-rose-500'
                    : 'border-slate-200 dark:border-slate-700'
              }`}
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {wsIsEditable
                ? 'Paste the per-deployment WSS URL (resource + api-version + deployment). Leaving this blank will fail at call time.'
                : 'Fixed for this provider — the runtime substitutes the picked model into the template. No setup needed here.'}
            </p>
            {wsMissingForEditable && (
              <p className="mt-1 text-[11px] text-rose-500 dark:text-rose-400">
                Required — the realtime client has no way to dial without it.
              </p>
            )}
            {wsFixedButNoTemplate && (
              <p className="mt-1 text-[11px] text-rose-500 dark:text-rose-400">
                No WebSocket URL configured for this provider in the catalog — the realtime client will fail at call time. Have an admin populate <code>websocket_url_template</code> on this provider row.
              </p>
            )}
          </div>
        )}

        {/* Voice — voice-card only. Populated from the picked model's
            catalog (voices + default_voice came back from
            /api/llm/voice-models/). Empty selection means "use the
            catalog default" — backend resolver falls back to
            VoiceModel.default_voice. Per-bot override still works via
            the frontend-chatbot flow voicemodel node. */}
        {showVoiceField && (
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span>Voice</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                {voices.length > 0
                  ? `${voices.length} multilingual`
                  : (modelId ? 'no catalog' : 'pick a model first')}
              </span>
            </label>
            {voices.length > 0 ? (
              <CappedDropdown
                value={voiceName || ''}
                options={[
                  // Sentinel: "Use default" leaves voice_name='' so the
                  // backend resolver picks catalog default_voice.
                  { key: '', name: catalogDefaultVoice
                      ? `${(voiceCatalog?.voice_genders?.[catalogDefaultVoice] === 'female' ? '♀' : '♂')} Use default (${catalogDefaultVoice})`
                      : 'Use default' },
                  // Sorted: females first, males next, alphabetical within
                  // each group. Makes it easy to scan for a gendered pick.
                  ...[...voices]
                    .map((v) => ({
                      v,
                      g: (voiceCatalog?.voice_genders?.[v] || ''),
                    }))
                    .sort((a, b) => {
                      const order = { female: 0, male: 1 };
                      const oa = order[a.g] ?? 2;
                      const ob = order[b.g] ?? 2;
                      if (oa !== ob) return oa - ob;
                      return a.v.localeCompare(b.v);
                    })
                    .map(({ v, g }) => ({
                      key: v,
                      name: `${g === 'female' ? '♀' : g === 'male' ? '♂' : '•'} ${v}${v === catalogDefaultVoice ? ' (default)' : ''}`,
                    })),
                ]}
                onChange={(v) => onVoiceNameChange(v)}
                placeholder="Select voice"
                searchPlaceholder="Search voices…"
                maxHeight={260}
              />
            ) : (
              <div className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500">
                {modelId
                  ? 'Catalog has no voices for this model — runtime will use per-client hardcode.'
                  : 'Pick a model to see its voices.'}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {voiceName
                ? `Bots using "default" mode will speak as "${voiceName}". Per-bot override still works in the flow builder.`
                : (resolvedVoice
                    ? `Will fall back to "${resolvedVoice}" (catalog default).`
                    : 'Leave blank to use the catalog default.')}
            </p>
          </div>
        )}

        {/* Temperature */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Temperature
            </label>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {temperature ?? 'default'}
            </span>
          </div>
          <input
            type="range"
            value={temperature ?? 0.2}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            step="0.1"
            min="0"
            max="2"
            className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
            <span>0</span>
            <span>1</span>
            <span>2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillingConfigCard({ title, description, icon: Icon, iconColor, bgColor, borderAccent, config, onChange, onSave, saving }) {
  const update = (field, value) => onChange({ ...config, [field]: value });

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 border-t-4 ${borderAccent} p-6 flex flex-col`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className={`p-2.5 rounded-lg ${bgColor}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        {config.is_enabled && (
          <CheckCircle className="w-4 h-4 text-emerald-500" />
        )}
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 mb-4">
        <div>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Enable Billing</label>
          <p className="text-[10px] text-slate-400 dark:text-slate-500">Master switch for credit deductions</p>
        </div>
        <button
          type="button"
          onClick={() => update('is_enabled', !config.is_enabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            config.is_enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            config.is_enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`} />
        </button>
      </div>

      <div className={`space-y-4 flex-1 ${!config.is_enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Warning Balance */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Warning Balance
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={config.warning_balance}
            onChange={(e) => update('warning_balance', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
            Logs a warning when balance drops below this value
          </p>
        </div>

        {/* Minimum Balance (deactivation) */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Minimum Balance (Deactivation)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={config.minimum_balance}
            onChange={(e) => update('minimum_balance', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
            Bot is deactivated when balance falls below this value. Set to 0 to disable.
          </p>
        </div>

        {/* Fail Open toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
          <div>
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Fail Open</label>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Keep bot working if billing API is unreachable
            </p>
          </div>
          <button
            type="button"
            onClick={() => update('fail_open', !config.fail_open)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              config.fail_open ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              config.fail_open ? 'translate-x-[18px]' : 'translate-x-[2px]'
            }`} />
          </button>
        </div>

        {/* Max Failed Deductions */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Max Failed Deductions
          </label>
          <input
            type="number"
            step="1"
            min="1"
            value={config.max_failed_deductions}
            onChange={(e) => update('max_failed_deductions', parseInt(e.target.value) || 10)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
            Bot is deactivated after this many failed deductions accumulate
          </p>
        </div>
      </div>
      {onSave && (
        <div className="flex justify-end mt-5">
          <button onClick={onSave} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

export const DB_TYPES = ['Qdrant', 'Pinecone', 'Weaviate', 'ChromaDB', 'Milvus', 'PGVector', 'Supabase', 'Vector Store'];
const VECTOR_DB_TYPES = ['Qdrant', 'Pinecone', 'Weaviate', 'ChromaDB', 'Milvus', 'PGVector'];

export function DatabaseCard({
  dbType, onDbTypeChange,
  dbHost, onDbHostChange, dbPort, onDbPortChange, dbName, onDbNameChange,
  dbUsername, onDbUsernameChange, dbPassword, onDbPasswordChange,
  dbConnectionString, onDbConnectionStringChange,
  // Default values let Bot.jsx omit these props (it doesn't expose the
  // shared fields to admins; see showSharedFields below).
  dbExpandQueryCount = 4, onDbExpandQueryCountChange = () => {},
  dbToolDescription = '', onDbToolDescriptionChange = () => {},
  // Toggle the shared "Number of Search Queries" + "Database Description"
  // block. GlobalDefault page renders them (default true); per-bot Bot.jsx
  // hides them since those values are owned by the per-flow DatabaseNode.
  showSharedFields = true,
  dbSupabaseUrl, onDbSupabaseUrlChange,
  dbSupabaseAnonKey, onDbSupabaseAnonKeyChange,
  dbSupabaseServiceRoleKey, onDbSupabaseServiceRoleKeyChange,
  dbVectorStoreName, onDbVectorStoreNameChange,
  dbVectorStoreId, onDbVectorStoreIdChange,
  dbPineconeApiKey, onDbPineconeApiKeyChange,
  dbPineconeIndexName, onDbPineconeIndexNameChange,
  dbPineconeEnvironment, onDbPineconeEnvironmentChange,
  dbWeaviateUrl, onDbWeaviateUrlChange,
  dbWeaviateApiKey, onDbWeaviateApiKeyChange,
  dbWeaviateCollectionName, onDbWeaviateCollectionNameChange,
  dbChromaHost, onDbChromaHostChange,
  dbChromaPort, onDbChromaPortChange,
  dbChromaCollectionName, onDbChromaCollectionNameChange,
  dbMilvusUri, onDbMilvusUriChange,
  dbMilvusToken, onDbMilvusTokenChange,
  dbMilvusCollectionName, onDbMilvusCollectionNameChange,
  dbPgvectorHost, onDbPgvectorHostChange,
  dbPgvectorPort, onDbPgvectorPortChange,
  dbPgvectorDatabase, onDbPgvectorDatabaseChange,
  dbPgvectorUsername, onDbPgvectorUsernameChange,
  dbPgvectorPassword, onDbPgvectorPasswordChange,
  dbPgvectorTableName, onDbPgvectorTableNameChange,
  onSave, saving,
}) {
  const [showSupabaseAnon, setShowSupabaseAnon] = useState(false);
  const [showSupabaseRole, setShowSupabaseRole] = useState(false);
  const [showPineconeApiKey, setShowPineconeApiKey] = useState(false);
  const [showWeaviateApiKey, setShowWeaviateApiKey] = useState(false);
  const [showMilvusToken, setShowMilvusToken] = useState(false);
  const [showPgvectorPassword, setShowPgvectorPassword] = useState(false);

  const handleTypeChange = (type) => {
    onDbTypeChange(type);
    // Clear fields not relevant to the new type
    if (!VECTOR_DB_TYPES.includes(type)) {
      onDbExpandQueryCountChange(4);
      onDbToolDescriptionChange('');
    }
    if (type !== 'Supabase') {
      onDbSupabaseUrlChange('');
      onDbSupabaseAnonKeyChange('');
      onDbSupabaseServiceRoleKeyChange('');
    }
    if (type !== 'Vector Store') {
      onDbVectorStoreNameChange('');
      onDbVectorStoreIdChange('');
    }
    if (type !== 'Pinecone') {
      onDbPineconeApiKeyChange('');
      onDbPineconeIndexNameChange('');
      onDbPineconeEnvironmentChange('');
    }
    if (type !== 'Weaviate') {
      onDbWeaviateUrlChange('');
      onDbWeaviateApiKeyChange('');
      onDbWeaviateCollectionNameChange('');
    }
    if (type !== 'ChromaDB') {
      onDbChromaHostChange('');
      onDbChromaPortChange('');
      onDbChromaCollectionNameChange('');
    }
    if (type !== 'Milvus') {
      onDbMilvusUriChange('');
      onDbMilvusTokenChange('');
      onDbMilvusCollectionNameChange('');
    }
    if (type !== 'PGVector') {
      onDbPgvectorHostChange('');
      onDbPgvectorPortChange('');
      onDbPgvectorDatabaseChange('');
      onDbPgvectorUsernameChange('');
      onDbPgvectorPasswordChange('');
      onDbPgvectorTableNameChange('');
    }
  };

  const inputClass = "w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent";
  const eyeBtnClass = "absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300";

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 border-t-4 border-t-green-500 p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2.5 rounded-lg bg-green-500/10">
          <Database className="w-5 h-5 text-green-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Vector Database</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Default vector database for store and data operations</p>
        </div>
        {dbType && <CheckCircle className="w-4 h-4 text-emerald-500" />}
      </div>

      <div className="space-y-4">
        {/* Database Type */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Vector Database Type</label>
          <select value={dbType} onChange={(e) => handleTypeChange(e.target.value)} className={inputClass}>
            <option value="">Select database type</option>
            {DB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Shared vector DB fields: Search Queries + Description */}
        {showSharedFields && VECTOR_DB_TYPES.includes(dbType) && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Number of Search Queries</label>
              <input type="number" min="1" max="10" value={dbExpandQueryCount} onChange={(e) => { const v = parseInt(e.target.value); onDbExpandQueryCountChange(isNaN(v) ? 4 : Math.max(1, Math.min(10, v))); }} className={inputClass} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Number of query variations for retrieval (1-10)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Database Description</label>
              <textarea value={dbToolDescription} onChange={(e) => onDbToolDescriptionChange(e.target.value)} placeholder="Describe what data this database contains to help the agent search effectively..." rows={3} className={inputClass} />
            </div>
          </div>
        )}

        {/* Qdrant fields */}
        {dbType === 'Qdrant' && (
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Endpoint URL</label>
            <input type="text" value={dbConnectionString} onChange={(e) => onDbConnectionStringChange(e.target.value)} placeholder="http://localhost:6333" className={`${inputClass} font-mono text-xs`} />
          </div>
        )}

        {/* Pinecone fields */}
        {dbType === 'Pinecone' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">API Key</label>
              <div className="relative">
                <input type={showPineconeApiKey ? 'text' : 'password'} value={dbPineconeApiKey} onChange={(e) => onDbPineconeApiKeyChange(e.target.value)} placeholder="pc-..." className={`${inputClass} pr-10 font-mono text-xs`} />
                <button type="button" onClick={() => setShowPineconeApiKey(!showPineconeApiKey)} className={eyeBtnClass}>
                  {showPineconeApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Index Name</label>
              <input type="text" value={dbPineconeIndexName} onChange={(e) => onDbPineconeIndexNameChange(e.target.value)} placeholder="my-index" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Index Host URL</label>
              <input type="text" value={dbPineconeEnvironment} onChange={(e) => onDbPineconeEnvironmentChange(e.target.value)} placeholder="https://my-index-xxx.svc.pinecone.io" className={`${inputClass} font-mono text-xs`} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Optional. Auto-resolved from index name if empty.</p>
            </div>
          </div>
        )}

        {/* Weaviate fields */}
        {dbType === 'Weaviate' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">URL</label>
              <input type="text" value={dbWeaviateUrl} onChange={(e) => onDbWeaviateUrlChange(e.target.value)} placeholder="https://cluster.weaviate.network" className={`${inputClass} font-mono text-xs`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">API Key</label>
              <div className="relative">
                <input type={showWeaviateApiKey ? 'text' : 'password'} value={dbWeaviateApiKey} onChange={(e) => onDbWeaviateApiKeyChange(e.target.value)} placeholder="API key" className={`${inputClass} pr-10 font-mono text-xs`} />
                <button type="button" onClick={() => setShowWeaviateApiKey(!showWeaviateApiKey)} className={eyeBtnClass}>
                  {showWeaviateApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Required for cloud, optional for local.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Collection Name</label>
              <input type="text" value={dbWeaviateCollectionName} onChange={(e) => onDbWeaviateCollectionNameChange(e.target.value)} placeholder="Optional. Searches all if empty." className={inputClass} />
            </div>
          </div>
        )}

        {/* ChromaDB fields */}
        {dbType === 'ChromaDB' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Host</label>
              <input type="text" value={dbChromaHost} onChange={(e) => onDbChromaHostChange(e.target.value)} placeholder="localhost" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Port</label>
              <input type="text" value={dbChromaPort} onChange={(e) => onDbChromaPortChange(e.target.value)} placeholder="8000" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Collection Name</label>
              <input type="text" value={dbChromaCollectionName} onChange={(e) => onDbChromaCollectionNameChange(e.target.value)} placeholder="my-collection" className={inputClass} />
            </div>
          </div>
        )}

        {/* Milvus fields */}
        {dbType === 'Milvus' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">URI</label>
              <input type="text" value={dbMilvusUri} onChange={(e) => onDbMilvusUriChange(e.target.value)} placeholder="http://localhost:19530" className={`${inputClass} font-mono text-xs`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Token / API Key</label>
              <div className="relative">
                <input type={showMilvusToken ? 'text' : 'password'} value={dbMilvusToken} onChange={(e) => onDbMilvusTokenChange(e.target.value)} placeholder="Required for Zilliz Cloud" className={`${inputClass} pr-10 font-mono text-xs`} />
                <button type="button" onClick={() => setShowMilvusToken(!showMilvusToken)} className={eyeBtnClass}>
                  {showMilvusToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Collection Name</label>
              <input type="text" value={dbMilvusCollectionName} onChange={(e) => onDbMilvusCollectionNameChange(e.target.value)} placeholder="my-collection" className={inputClass} />
            </div>
          </div>
        )}

        {/* PGVector fields */}
        {dbType === 'PGVector' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Host</label>
              <input type="text" value={dbPgvectorHost} onChange={(e) => onDbPgvectorHostChange(e.target.value)} placeholder="localhost" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Port</label>
              <input type="text" value={dbPgvectorPort} onChange={(e) => onDbPgvectorPortChange(e.target.value)} placeholder="5432" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Database</label>
              <input type="text" value={dbPgvectorDatabase} onChange={(e) => onDbPgvectorDatabaseChange(e.target.value)} placeholder="my_database" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Username</label>
              <input type="text" value={dbPgvectorUsername} onChange={(e) => onDbPgvectorUsernameChange(e.target.value)} placeholder="postgres" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
              <div className="relative">
                <input type={showPgvectorPassword ? 'text' : 'password'} value={dbPgvectorPassword} onChange={(e) => onDbPgvectorPasswordChange(e.target.value)} placeholder="password" className={`${inputClass} pr-10`} />
                <button type="button" onClick={() => setShowPgvectorPassword(!showPgvectorPassword)} className={eyeBtnClass}>
                  {showPgvectorPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Table Name</label>
              <input type="text" value={dbPgvectorTableName} onChange={(e) => onDbPgvectorTableNameChange(e.target.value)} placeholder="embeddings" className={inputClass} />
            </div>
          </div>
        )}

        {/* Supabase fields */}
        {dbType === 'Supabase' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Supabase URL</label>
              <input type="text" value={dbSupabaseUrl} onChange={(e) => onDbSupabaseUrlChange(e.target.value)} placeholder="https://your-project.supabase.co" className={`${inputClass} font-mono text-xs`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Anon Key</label>
              <div className="relative">
                <input type={showSupabaseAnon ? 'text' : 'password'} value={dbSupabaseAnonKey} onChange={(e) => onDbSupabaseAnonKeyChange(e.target.value)} placeholder="eyJ..." className={`${inputClass} pr-10 font-mono text-xs`} />
                <button type="button" onClick={() => setShowSupabaseAnon(!showSupabaseAnon)} className={eyeBtnClass}>
                  {showSupabaseAnon ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Service Role Key</label>
              <div className="relative">
                <input type={showSupabaseRole ? 'text' : 'password'} value={dbSupabaseServiceRoleKey} onChange={(e) => onDbSupabaseServiceRoleKeyChange(e.target.value)} placeholder="eyJ..." className={`${inputClass} pr-10 font-mono text-xs`} />
                <button type="button" onClick={() => setShowSupabaseRole(!showSupabaseRole)} className={eyeBtnClass}>
                  {showSupabaseRole ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Vector Store fields */}
        {dbType === 'Vector Store' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Vector Store Name</label>
              <input type="text" value={dbVectorStoreName} onChange={(e) => onDbVectorStoreNameChange(e.target.value)} placeholder="my-vector-store" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Vector Store ID</label>
              <input type="text" value={dbVectorStoreId} onChange={(e) => onDbVectorStoreIdChange(e.target.value)} placeholder="vs_..." className={`${inputClass} font-mono text-xs`} />
            </div>
          </div>
        )}
      </div>

      {onSave && (
        <div className="flex justify-end mt-5">
          <button onClick={onSave} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Vector Database Default'}
          </button>
        </div>
      )}
    </div>
  );
}

export default GlobalDefault;

