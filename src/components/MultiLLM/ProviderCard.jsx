import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import ModelRow from './ModelRow';

function ProviderCard({ provider, collapsed, onToggleCollapse, onToggleModel, onEditKey }) {
  const enabledCount = provider.models.filter((m) => m.enabled).length;
  const total = provider.models.length;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-r from-slate-50/50 to-transparent dark:from-slate-800/30 dark:to-transparent">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => onToggleCollapse(provider.key)}
            className="flex items-center gap-2 text-left flex-1 min-w-0"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            )}
            <span className="font-semibold text-slate-900 dark:text-white truncate">
              {provider.name}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {enabledCount} of {total} enabled
            </span>
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <code className="text-xs font-mono px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded border border-slate-200 dark:border-slate-700">
              {provider.maskedKey}
            </code>
            <button
              type="button"
              onClick={() => onEditKey(provider.key)}
              className="p-1.5 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
              title={`Edit ${provider.name} API key`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="p-2 space-y-0.5">
          {provider.models.map((m) => (
            <ModelRow
              key={m.id}
              providerKey={provider.key}
              model={m}
              onToggle={onToggleModel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ProviderCard;
