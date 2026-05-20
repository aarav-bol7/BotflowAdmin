import { useState } from 'react';
import { Eye, EyeOff, Brain, Cpu, Sparkles, Cloud, Server, Save } from 'lucide-react';

const AGENT_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Most popular provider with best tool-calling support. Powers GPT-4o and GPT-4 Turbo models.',
    color: 'emerald',
    icon: Sparkles,
    defaultModel: 'openai/gpt-4o',
    models: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-4-turbo', 'openai/gpt-4'],
    fields: [
      { key: 'model', label: 'Model String (LiteLLM)', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'secret' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Strong reasoning and reliable tool use. Excels at complex multi-step agent tasks.',
    color: 'orange',
    icon: Brain,
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    models: ['anthropic/claude-sonnet-4-20250514', 'anthropic/claude-3-5-sonnet-20241022', 'anthropic/claude-3-haiku-20240307'],
    fields: [
      { key: 'model', label: 'Model String (LiteLLM)', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'secret' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Large context window and multimodal support. Native function calling with Gemini models.',
    color: 'blue',
    icon: Cpu,
    defaultModel: 'gemini/gemini-1.5-pro',
    models: ['gemini/gemini-1.5-pro', 'gemini/gemini-1.5-flash', 'gemini/gemini-2.0-flash'],
    fields: [
      { key: 'model', label: 'Model String (LiteLLM)', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'secret' },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Open-weight models with function calling support. Good balance of speed and capability.',
    color: 'violet',
    icon: Sparkles,
    defaultModel: 'mistral/mistral-large-latest',
    models: ['mistral/mistral-large-latest', 'mistral/mistral-medium-latest'],
    fields: [
      { key: 'model', label: 'Model String (LiteLLM)', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'secret' },
    ],
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    description: 'Enterprise-grade OpenAI models via Azure. Requires Azure deployment endpoint URL.',
    color: 'sky',
    icon: Cloud,
    defaultModel: 'azure/gpt-4',
    models: ['azure/gpt-4', 'azure/gpt-35-turbo'],
    fields: [
      { key: 'model', label: 'Model String (LiteLLM)', type: 'text' },
      { key: 'apiKey', label: 'API Key', type: 'secret' },
      { key: 'endpoint', label: 'Endpoint URL', type: 'text' },
    ],
  },
];

const COLOR_MAP = {
  emerald: {
    border: 'border-t-emerald-500',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    tag: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  orange: {
    border: 'border-t-orange-500',
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-600 dark:text-orange-400',
    tag: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  },
  blue: {
    border: 'border-t-blue-500',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-600 dark:text-blue-400',
    tag: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
  violet: {
    border: 'border-t-violet-500',
    bg: 'bg-violet-100 dark:bg-violet-900/30',
    text: 'text-violet-600 dark:text-violet-400',
    tag: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
  },
  sky: {
    border: 'border-t-sky-500',
    bg: 'bg-sky-100 dark:bg-sky-900/30',
    text: 'text-sky-600 dark:text-sky-400',
    tag: 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  },
};

function ProviderCard({ provider }) {
  const colors = COLOR_MAP[provider.color];
  const Icon = provider.icon;

  const [values, setValues] = useState(() => {
    const init = {};
    provider.fields.forEach(f => {
      init[f.key] = f.key === 'model' ? provider.defaultModel : '';
    });
    return init;
  });
  const [visibleSecrets, setVisibleSecrets] = useState({});

  const toggleSecret = (key) => {
    setVisibleSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateValue = (key, val) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 border-t-4 ${colors.border} p-6 flex flex-col gap-4`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${colors.text}`} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">{provider.name}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{provider.description}</p>
        </div>
      </div>

      {/* Supported Models Tags */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          Supported Models
        </label>
        <div className="flex flex-wrap gap-1.5">
          {provider.models.map(m => (
            <span
              key={m}
              onClick={() => updateValue('model', m)}
              className={`text-xs px-2 py-0.5 rounded-md border cursor-pointer hover:opacity-80 transition-opacity ${colors.tag}`}
            >
              {m.split('/')[1]}
            </span>
          ))}
        </div>
      </div>

      {/* Fields */}
      {provider.fields.map(field => (
        <div key={field.key}>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            {field.label}
          </label>
          {field.type === 'secret' ? (
            <div className="relative">
              <input
                type={visibleSecrets[field.key] ? 'text' : 'password'}
                value={values[field.key]}
                onChange={(e) => updateValue(field.key, e.target.value)}
                placeholder={`Enter ${field.label}`}
                className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => toggleSecret(field.key)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {visibleSecrets[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={values[field.key]}
              onChange={(e) => updateValue(field.key, e.target.value)}
              placeholder={`Enter ${field.label}`}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function AIAgent() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Info Banner */}
      <div className="mb-6 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/50 dark:border-indigo-800/50">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Brain className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">AI Agent Providers</h3>
            <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
              Configure LLM providers that support agent mode with tool/function calling.
              Each provider requires a model string in LiteLLM format (<code className="px-1 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-xs">provider/model</code>) and an API key.
              Click on a model tag to auto-fill the model string field.
            </p>
          </div>
        </div>
      </div>

      {/* Provider Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {AGENT_PROVIDERS.map(provider => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>

      {/* Save Button */}
      <div className="mt-8 flex justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
        >
          <Save className="w-4 h-4" />
          Save Configuration
        </button>
      </div>
    </div>
  );
}

export default AIAgent;
