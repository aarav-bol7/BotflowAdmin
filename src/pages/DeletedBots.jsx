import { useEffect, useMemo, useState } from 'react';
import { Archive, RefreshCcw, Search } from 'lucide-react';
import { flowService } from '../api/flowService';
import { getTenants as enumGetTenants } from '../api/enumerationService';

function DeletedBots() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tenantFilter, setTenantFilter] = useState('');
  const [tenantList, setTenantList] = useState([]);
  const [search, setSearch] = useState('');

  const loadRows = async (tenantId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await flowService.listDeletedBots(tenantId);
      setRows(res.results || []);
    } catch (err) {
      setError(err.message || 'Failed to load deleted bots');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    enumGetTenants()
      .then(d => setTenantList(d.tenants || []))
      .catch(() => setTenantList([]));
    loadRows(tenantFilter.trim() || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => loadRows(tenantFilter.trim() || undefined);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r =>
      (r.botName || '').toLowerCase().includes(needle) ||
      (r.botKey || '').toLowerCase().includes(needle) ||
      (r.tenantId || '').toLowerCase().includes(needle)
    );
  }, [rows, search]);

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  };

  const formatNumber = (n) => {
    if (n == null) return '0';
    return Number(n).toLocaleString();
  };

  const formatCost = (n) => {
    if (n == null) return '$0.00';
    return `$${Number(n).toFixed(4)}`;
  };

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
          <Archive className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            Deleted Bots
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Soft-deleted bots. Conversation history and billing data are retained until purge.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="ml-auto px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-sm"
        >
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search name, key, tenant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm min-w-[260px]"
          />
        </div>
        <div className="flex items-center gap-2">
          {tenantList.length > 0 ? (
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm min-w-[240px]"
            >
              <option value="">All Tenants</option>
              {tenantList.map((tenant) => (
                <option key={tenant.tenantId} value={tenant.tenantId}>
                  {tenant.tenantName || tenant.tenantId}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Filter by tenant_id (empty = all)"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm min-w-[240px]"
            />
          )}
          <button
            onClick={handleRefresh}
            className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Apply
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">BOT</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">TENANT</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">DELETED AT</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">TOKENS</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">COST</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">SESSIONS</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">CALLS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No deleted bots.
                </td>
              </tr>
            )}
            {!loading && filteredRows.map((r) => (
              <tr key={`${r.tenantId}::${r.botKey}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3 text-sm">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {r.botName || r.botKey}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{r.botKey}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                  {r.tenantId}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-white">
                  {formatDate(r.deletedAt)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium text-slate-900 dark:text-white tabular-nums">
                  {formatNumber(r.totalTokens)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium text-slate-900 dark:text-white tabular-nums">
                  {formatCost(r.totalCost)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium text-slate-900 dark:text-white tabular-nums">
                  {formatNumber(r.sessionCount)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium text-slate-900 dark:text-white tabular-nums">
                  {formatNumber(r.callSessionCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DeletedBots;
