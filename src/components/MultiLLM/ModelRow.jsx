function ModelRow({ providerKey, model, onToggle }) {
  return (
    <label
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
    >
      <input
        type="checkbox"
        checked={model.enabled}
        onChange={() => onToggle(providerKey, model.id)}
        className="w-4 h-4 text-indigo-600 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded focus:ring-indigo-500 focus:ring-2 cursor-pointer"
      />
      <span className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all">
        {model.id}
      </span>
    </label>
  );
}

export default ModelRow;
