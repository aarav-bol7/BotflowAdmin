import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';

// Parent controls mount/unmount so draft + show reset naturally per open.
function EditKeyModal({ providerName, onCancel, onSave }) {
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    onSave(draft);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50"
        onClick={onCancel}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <form
          onSubmit={handleSave}
          className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200/50 dark:border-slate-800/50 w-full max-w-md pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
              <KeyRound className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Edit {providerName} API Key
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Stored locally — masked on save.
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="sk-..."
                autoFocus
                className="w-full px-3 py-2 pr-10 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
                title={show ? 'Hide key' : 'Show key'}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default EditKeyModal;
