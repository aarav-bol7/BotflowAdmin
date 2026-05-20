import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Loader2, Brain, Mic, Database, AlertCircle, CheckCircle, Eye, EyeOff, CreditCard, Phone, Bell, RefreshCw } from 'lucide-react';
import { flowService } from '../api/flowService';
import { botflowWs } from '../api/botflowWebSocket';
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

  // ─── Track D: cross-session sync state ─────────────────────────────────
  // lastLoaded* refs hold the last server-authoritative values. Diffing local
  // state vs these refs yields per-field dirty detection without instrumenting
  // every onChange handler. When a WS update event arrives, we split incoming
  // fields into "clean" (silent replace) and "conflict" (banner) by comparing
  // local=lastLoaded (clean) vs local!=lastLoaded (dirty).
  const lastLoadedDefaultsRef = useRef({ chat: {}, voice: {}, database: {}, notifications: {} });
  const lastLoadedBillingRef = useRef({ llm: null, voice: null });
  const isInitialFetchPendingRef = useRef(true);
  const hasPendingEventRef = useRef(false);
  // externalChanges: per-section map of {field: {incomingValue, sectionKey}}.
  // Non-empty map renders the sticky banner above the page.
  const [externalChanges, setExternalChanges] = useState({});

  // Refs so WS handlers always see latest local state for dirty detection.
  const localChatRef = useRef({});
  const localVoiceRef = useRef({});
  const localDbRef = useRef({});
  const localLlmBillingRef = useRef({});
  const localVoiceBillingRef = useRef({});
  const localNotificationsRef = useRef({});

  useEffect(() => {
    Promise.all([
      flowService.getProviders().catch(() => []),
      flowService.getGlobalDefaults().catch(() => ({ chat: {}, voice: {} })),
      flowService.getBillingConfig().catch(() => null),
    ]).then(([providerList, defaults, billingConfig]) => {
      setProviders(providerList || []);
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
    };
  }, [voiceProviderKey, voiceModelId, voiceApiKey, voiceTemperature]);
  useEffect(() => { localLlmBillingRef.current = llmBilling; }, [llmBilling]);
  useEffect(() => { localVoiceBillingRef.current = voiceBilling; }, [voiceBilling]);
  useEffect(() => {
    localNotificationsRef.current = { notifications_enabled: notificationsEnabled };
  }, [notificationsEnabled]);

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
    if (Object.keys(allConflicts).length > 0) {
      setExternalChanges((prev) => ({ ...prev, ...allConflicts }));
    }
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
    if (Object.keys(conflicts).length > 0) {
      setExternalChanges((prev) => ({ ...prev, ...conflicts }));
    }
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

  // Banner action: apply all pending external changes and clear banner.
  const applyExternalChanges = useCallback(() => {
    Object.entries(externalChanges).forEach(([field, { incomingValue, sectionKey }]) => {
      // Defaults — chat
      if (sectionKey === 'chat') {
        if (field === 'provider_key') setChatProviderKey(incomingValue);
        else if (field === 'model_id') setChatModelId(incomingValue);
        else if (field === 'api_key') setChatApiKey(incomingValue);
        else if (field === 'temperature') setChatTemperature(incomingValue);
        lastLoadedDefaultsRef.current.chat[field] = incomingValue;
      } else if (sectionKey === 'voice') {
        if (field === 'provider_key') setVoiceProviderKey(incomingValue);
        else if (field === 'model_id') setVoiceModelId(incomingValue);
        else if (field === 'api_key') setVoiceApiKey(incomingValue);
        else if (field === 'temperature') setVoiceTemperature(incomingValue);
        lastLoadedDefaultsRef.current.voice[field] = incomingValue;
      } else if (sectionKey === 'notifications') {
        if (field === 'notifications_enabled') setNotificationsEnabled(!!incomingValue);
        lastLoadedDefaultsRef.current.notifications[field] = incomingValue;
      } else if (sectionKey === 'database') {
        applyDatabasePayload(incomingValue);
        lastLoadedDefaultsRef.current.database = { ...incomingValue };
      } else if (sectionKey === 'billing.llm') {
        setLlmBilling(incomingValue);
        if (!lastLoadedBillingRef.current) lastLoadedBillingRef.current = {};
        lastLoadedBillingRef.current.llm = { ...incomingValue };
      } else if (sectionKey === 'billing.voice') {
        setVoiceBilling(incomingValue);
        if (!lastLoadedBillingRef.current) lastLoadedBillingRef.current = {};
        lastLoadedBillingRef.current.voice = { ...incomingValue };
      }
    });
    setExternalChanges({});
  }, [externalChanges]);

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

  const handleProviderChange = (type, key) => {
    if (type === 'chat') {
      setChatProviderKey(key);
      setChatModelId('');
    } else {
      setVoiceProviderKey(key);
      setVoiceModelId('');
    }
  };

  const handleSaveModels = async () => {
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

      {/* Track D: external-change banner. Non-dismissible — "Refresh" is the
          only way to clear it. Prevents silent revert of another admin's edit. */}
      {Object.keys(externalChanges).length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
          <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Another admin updated these settings:
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {Object.keys(externalChanges).join(', ')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Your local edits are preserved. Click &quot;Refresh&quot; to replace them with the
              latest values, or save to keep your edits (overwriting theirs).
            </p>
          </div>
          <button
            onClick={applyExternalChanges}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      )}

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
          description="Default model for voice/realtime interactions"
          icon={Mic}
          iconColor="text-purple-500"
          bgColor="bg-purple-500/10"
          borderAccent="border-t-purple-500"
          providers={providers}
          providerKey={voiceProviderKey}
          modelId={voiceModelId}
          apiKey={voiceApiKey}
          temperature={voiceTemperature}
          onProviderChange={(key) => handleProviderChange('voice', key)}
          onModelChange={setVoiceModelId}
          onApiKeyChange={setVoiceApiKey}
          onTemperatureChange={setVoiceTemperature}
          getModels={getModelsForProvider}
        />
      </div>
      <div className="flex justify-end">
        <button onClick={handleSaveModels} disabled={savingModels} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors">
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
    </div>
  );
}

function ModelCard({ title, description, icon: Icon, iconColor, bgColor, borderAccent, providers, providerKey, modelId, apiKey, temperature, onProviderChange, onModelChange, onApiKeyChange, onTemperatureChange, getModels }) {
  const models = getModels(providerKey);
  const hasSelection = providerKey && modelId;
  const [showApiKey, setShowApiKey] = useState(false);

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
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Provider
          </label>
          <select
            value={providerKey}
            onChange={(e) => onProviderChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select provider</option>
            {providers.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            Model
          </label>
          <select
            value={modelId}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={!providerKey}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select model</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
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

