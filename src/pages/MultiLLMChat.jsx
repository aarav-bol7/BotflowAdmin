import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Bell, RefreshCw, Loader2, AlertTriangle, ServerCrash } from 'lucide-react';
import { litellmService, MissingTokenError } from '../api/litellmService';
import { groupModels, makeMaskedKey } from '../components/MultiLLM/providerClassifier';
import ProviderCard from '../components/MultiLLM/ProviderCard';
import EditKeyModal from '../components/MultiLLM/EditKeyModal';
import NotificationsList from '../components/MultiLLM/NotificationsList';

function MultiLLMChat() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { kind: 'missing_token'|'fetch', message }
  const [activeSubTab, setActiveSubTab] = useState('models');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [editKeyModal, setEditKeyModal] = useState({ open: false, providerKey: null });

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await litellmService.listModels();
      const grouped = groupModels(data);
      setProviders(grouped);
      // Default: first provider expanded, rest collapsed.
      setCollapsed(new Set(grouped.slice(1).map((p) => p.key)));
    } catch (e) {
      if (e instanceof MissingTokenError) {
        setError({ kind: 'missing_token', message: e.message });
      } else {
        setError({ kind: 'fetch', message: e.message || 'Failed to load models' });
      }
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleToggleCollapse = useCallback((providerKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(providerKey)) next.delete(providerKey);
      else next.add(providerKey);
      return next;
    });
  }, []);

  const handleToggleModel = useCallback((providerKey, modelId) => {
    setProviders((prev) =>
      prev.map((p) =>
        p.key !== providerKey
          ? p
          : {
              ...p,
              models: p.models.map((m) =>
                m.id === modelId ? { ...m, enabled: !m.enabled } : m
              ),
            }
      )
    );
  }, []);

  const handleOpenEditKey = useCallback((providerKey) => {
    setEditKeyModal({ open: true, providerKey });
  }, []);

  const handleCancelEditKey = useCallback(() => {
    setEditKeyModal({ open: false, providerKey: null });
  }, []);

  const handleSaveEditKey = useCallback(() => {
    // Scaffolding: rotate to a new masked key regardless of input. No network.
    setProviders((prev) =>
      prev.map((p) =>
        p.key !== editKeyModal.providerKey ? p : { ...p, maskedKey: makeMaskedKey() }
      )
    );
    setEditKeyModal({ open: false, providerKey: null });
  }, [editKeyModal.providerKey]);

  const editingProvider = editKeyModal.providerKey
    ? providers.find((p) => p.key === editKeyModal.providerKey)
    : null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
            <span>MultiLLM Chat</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure which models appear in the multichat UI.
          </p>
        </div>
        {activeSubTab === 'models' && (
          <button
            type="button"
            onClick={loadModels}
            className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveSubTab('models')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeSubTab === 'models'
              ? 'bg-indigo-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Models
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('notifications')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            activeSubTab === 'notifications'
              ? 'bg-indigo-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
          }`}
        >
          <Bell className="w-4 h-4" />
          Notifications
        </button>
      </div>

      {/* Models sub-tab */}
      {activeSubTab === 'models' && (
        <div>
          {error?.kind === 'missing_token' && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-900 dark:text-yellow-200">
                <p className="font-semibold">LiteLLM token not configured</p>
                <p className="mt-1">
                  Set <code className="font-mono px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 rounded">VITE_LITELLM_TOKEN</code> in <code className="font-mono px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 rounded">.env</code> and restart the dev server.
                </p>
              </div>
            </div>
          )}

          {error?.kind === 'fetch' && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-xl p-4 flex items-start gap-3">
              <ServerCrash className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-red-900 dark:text-red-200">
                <p className="font-semibold">{error.message}</p>
                <button
                  type="button"
                  onClick={loadModels}
                  className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {loading && !error && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          )}

          {!loading && !error && providers.length === 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-12 text-center">
              <Sparkles className="w-12 h-12 text-slate-400 dark:text-slate-500 mx-auto mb-4" />
              <p className="text-slate-600 dark:text-slate-400 font-medium">
                No models returned by gateway
              </p>
            </div>
          )}

          {!loading && !error && providers.length > 0 && (
            <div className="space-y-3">
              {providers.map((p) => (
                <ProviderCard
                  key={p.key}
                  provider={p}
                  collapsed={collapsed.has(p.key)}
                  onToggleCollapse={handleToggleCollapse}
                  onToggleModel={handleToggleModel}
                  onEditKey={handleOpenEditKey}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notifications sub-tab */}
      {activeSubTab === 'notifications' && <NotificationsList />}

      {/* Edit-key modal — parent mounts/unmounts so internal state resets per open */}
      {editKeyModal.open && (
        <EditKeyModal
          key={editKeyModal.providerKey}
          providerName={editingProvider?.name || ''}
          onCancel={handleCancelEditKey}
          onSave={handleSaveEditKey}
        />
      )}
    </div>
  );
}

export default MultiLLMChat;
