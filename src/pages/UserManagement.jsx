import { useState, useEffect, useCallback, useRef } from 'react';
import React from 'react';
import { Search, Bot, Phone, MessageSquare, Building2, Filter, Copy, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { userManagementService } from '../api/userManagementService';
import { botflowWs } from '../api/botflowWebSocket';

function UserManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('bots'); // 'bots' or 'clients'
  const [filterType, setFilterType] = useState('all'); // 'all', 'voice', 'chat', 'both'
  const [expandedBots, setExpandedBots] = useState([]);
  const [expandedClients, setExpandedClients] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshingBalance, setRefreshingBalance] = useState(false);

  const [bots, setBots] = useState([]);
  const [clients, setClients] = useState([]);

  // Client-side pagination (backend returns up to pageSize=200 bots and all clients at once).
  const PAGE_SIZE = 20;
  const [botsPage, setBotsPage] = useState(1);
  const [clientsPage, setClientsPage] = useState(1);

  // Refs for WS handlers
  const searchRef = useRef('');
  const wsConnectedRef = useRef(false);
  const pollingRef = useRef(null);
  const pollDelayRef = useRef(null);
  const statsDebounceRef = useRef(null);

  useEffect(() => { searchRef.current = searchTerm; }, [searchTerm]);

  const fetchBots = useCallback((silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    userManagementService.getBots({ search: searchRef.current })
      .then((data) => {
        const mapped = (data.flows || []).map(f => ({
          botId: f.flowId,
          botName: f.name,
          clientId: f.tenantId,
          clientName: f.tenantName || f.tenantId,
          type: f.botType || 'chat',
          totalUsers: f.users || 0,
          activeUsers: f.activeUsers || 0,
          usedTokens: f.totalTokens || 0,
          totalCalls: f.calls || 0,
          totalCallDuration: f.totalCallDuration || 0,
          avgCallDuration: f.avgCallDuration || 0,
          lastActivity: f.lastActive ? new Date(f.lastActive).toLocaleString() : '—',
          status: f.botStatus || 'unknown',
          creditsUsed: f.creditsUsed || 0,
        }));
        setBots(mapped);
      })
      .catch((err) => { if (!silent) setError(err.message); })
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  const fetchClients = useCallback(() => {
    userManagementService.getClients()
      .then((data) => {
        const mapped = (data.clients || []).map(c => ({
          clientId: c.tenantId,
          clientName: c.tenantName || c.tenantId,
          totalBots: c.totalBots || 0,
          // userCount = distinct users (text + voice), same semantic as the
          // Bots tab; sessionCount kept as fallback for an older backend.
          totalUsers: c.userCount ?? c.sessionCount ?? 0,
          activeUsers: c.activeUsers || 0,
          totalUsedTokens: c.totalTokens || 0,
          totalCalls: c.totalCalls || 0,
          totalCallDuration: c.totalCallDuration || 0,
          avgCallDuration: c.avgCallDuration || 0,
          bots: c.botNames || [],
          status: c.status || 'unknown',
          creditBalance: c.creditBalance,
          creditsUsed: c.creditsUsed || 0,
          createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—',
          lastActivity: c.lastActivity ? new Date(c.lastActivity).toLocaleString() : '—',
        }));
        setClients(mapped);
      })
      .catch((err) => setError(err.message));
  }, []);

  const refreshBalance = useCallback(() => {
    setRefreshingBalance(true);
    userManagementService.getClients()
      .then((data) => {
        setClients(prev => prev.map(existing => {
          const updated = (data.clients || []).find(c => c.tenantId === existing.clientId);
          return updated ? { ...existing, creditBalance: updated.creditBalance } : existing;
        }));
      })
      .catch((err) => setError(err.message))
      .finally(() => setRefreshingBalance(false));
  }, []);

  useEffect(() => { fetchBots(); }, [fetchBots]);
  useEffect(() => { fetchClients(); }, [fetchClients]);

  // Debounced search: re-fetch from API when search term changes (300ms)
  const searchMountedRef = useRef(false);
  useEffect(() => {
    if (!searchMountedRef.current) { searchMountedRef.current = true; return; }
    const t = setTimeout(() => fetchBots(true), 300);
    return () => clearTimeout(t);
  }, [searchTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatDuration = (seconds) => {
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes} min ${remainingSeconds} sec`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} hr ${remainingMinutes} min`;
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getTypeBadge = (type) => {
    const config = {
      voice:  { bg: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400', icon: <Phone className="w-3 h-3" /> },
      chat:   { bg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400', icon: <MessageSquare className="w-3 h-3" /> },
      both:   { bg: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400', icon: <><Phone className="w-3 h-3" /><MessageSquare className="w-3 h-3" /></> },
    };
    return config[type] || config.chat;
  };

  const toggleBotExpand = (botId) => {
    setExpandedBots(prev => 
      prev.includes(botId) 
        ? prev.filter(id => id !== botId)
        : [...prev, botId]
    );
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleClientExpand = (clientId) => {
    setExpandedClients(prev => 
      prev.includes(clientId) 
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    );
  };

  const getClientBots = (clientId) => {
    return bots.filter(bot => bot.clientId === clientId);
  };

  const filteredBots = bots.filter(bot => filterType === 'all' || bot.type === filterType);

  const filteredClients = clients.filter(client => {
    return client.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
           client.clientId.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Page reset on filter change happens inline in the onChange handlers.
  // Clamp here so filter changes that shrink results don't leave us on an empty page.
  const botsTotalPages = Math.max(1, Math.ceil(filteredBots.length / PAGE_SIZE));
  const clientsTotalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const effectiveBotsPage = Math.min(botsPage, botsTotalPages);
  const effectiveClientsPage = Math.min(clientsPage, clientsTotalPages);
  const pagedBots = filteredBots.slice((effectiveBotsPage - 1) * PAGE_SIZE, effectiveBotsPage * PAGE_SIZE);
  const pagedClients = filteredClients.slice((effectiveClientsPage - 1) * PAGE_SIZE, effectiveClientsPage * PAGE_SIZE);

  // ─── WebSocket: real-time updates ───────────────────────────────────────────
  useEffect(() => {
    botflowWs.connect();

    const silentRefresh = () => {
      fetchBots(true);
      fetchClients();
    };

    const debouncedRefresh = () => {
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      statsDebounceRef.current = setTimeout(silentRefresh, 2000);
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
          pollingRef.current = setInterval(silentRefresh, 15000);
        }
      }, 20000);
    });

    // Track B: bots + clients are mutable aggregates; since_ts catch-up does
    // not apply. Intentional blind refetch.
    const offReconnected = botflowWs.on('reconnected', () => {
      wsConnectedRef.current = true;
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      silentRefresh();
    });

    const offBotCreated = botflowWs.on('bot.created', debouncedRefresh);
    const offBotUpdated = botflowWs.on('bot.updated', debouncedRefresh);
    const offBotDeleted = botflowWs.on('bot.deleted', debouncedRefresh);
    const offStats = botflowWs.on('stats.updated', debouncedRefresh);
    const offCredits = botflowWs.on('credits.deducted', debouncedRefresh);

    return () => {
      offConnected(); offDisconnected(); offReconnected();
      offBotCreated(); offBotUpdated(); offBotDeleted();
      offStats(); offCredits();
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      if (pollDelayRef.current) clearTimeout(pollDelayRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
      botflowWs.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
          User Management
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage bots, clients, users, tokens, and call statistics
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('bots')}
          className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'bots'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Bots ({bots.length})
          </div>
        </button>
        <button
          onClick={() => setActiveTab('clients')}
          className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'clients'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Clients ({clients.length})
          </div>
        </button>
      </div>

      {/* Search and Filter Bar */}
      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setBotsPage(1); setClientsPage(1); }}
            placeholder={activeTab === 'bots' ? 'Search bots...' : 'Search clients...'}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        {activeTab === 'bots' && (
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-400" />
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setBotsPage(1); }}
              className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="all">All Types</option>
              <option value="voice">Voice</option>
              <option value="chat">Chat</option>
              <option value="both">Both</option>
            </select>
          </div>
        )}
      </div>

      {/* Loading & Error */}
      {loading && bots.length === 0 && clients.length === 0 && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      )}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Bots Tab Content */}
      {activeTab === 'bots' && (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      BOT NAME
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      CLIENT
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      TYPE
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      USERS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      TOKENS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      CALLS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      CALL DURATION
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      STATUS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {pagedBots.map((bot) => (
                    <React.Fragment key={bot.botId}>
                      <tr
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                        onClick={() => toggleBotExpand(bot.botId)}
                      >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                              {bot.botName}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(bot.botId, bot.botId);
                                }}
                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                                title="Copy Bot ID"
                              >
                                {copiedId === bot.botId ? (
                                  <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
                                )}
                              </button>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1 break-all">
                              {bot.botId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                        {bot.clientName}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit ${getTypeBadge(bot.type).bg}`}>
                          {getTypeBadge(bot.type).icon}
                          {bot.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white">
                          <div className="font-medium">{formatNumber(bot.totalUsers)}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {bot.activeUsers} active
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white font-medium">
                          {formatNumber(bot.usedTokens)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">tokens used</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">
                        {formatNumber(bot.totalCalls)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white">
                          <div className="font-medium">{formatDuration(bot.totalCallDuration)}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Avg: {(bot.avgCallDuration || 0).toFixed(1)}s
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            bot.status === 'active'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                          }`}>
                            {bot.status}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBotExpand(bot.botId);
                            }}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          >
                            {expandedBots.includes(bot.botId) ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedBots.includes(bot.botId) && (
                      <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                        <td colSpan="8" className="px-4 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Client ID</div>
                              <div className="text-slate-900 dark:text-white font-mono text-xs">{bot.clientId}</div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Last Activity</div>
                              <div className="text-slate-900 dark:text-white text-xs">{bot.lastActivity}</div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Users</div>
                              <div className="text-slate-900 dark:text-white font-semibold">{formatNumber(bot.totalUsers)}</div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Active Users</div>
                              <div className="text-slate-900 dark:text-white font-semibold text-green-600 dark:text-green-400">{formatNumber(bot.activeUsers)}</div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Tokens Used</div>
                              <div className="text-slate-900 dark:text-white font-semibold">
                                {formatNumber(bot.usedTokens)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Calls</div>
                              <div className="text-slate-900 dark:text-white font-semibold">{formatNumber(bot.totalCalls)}</div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Duration</div>
                              <div className="text-slate-900 dark:text-white font-semibold">{formatDuration(bot.totalCallDuration)}</div>
                            </div>
                            <div>
                              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Avg Call Duration</div>
                              <div className="text-slate-900 dark:text-white font-semibold">{(bot.avgCallDuration || 0).toFixed(1)}s</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {filteredBots.length} bot(s) found
              </p>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-3">
            {pagedBots.map((bot) => (
              <div
                key={bot.botId}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {bot.botName}
                        </h3>
                        <button
                          onClick={() => copyToClipboard(bot.botId, bot.botId)}
                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors flex-shrink-0"
                          title="Copy Bot ID"
                        >
                          {copiedId === bot.botId ? (
                            <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-400" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">
                        {bot.botId}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                    bot.status === 'active'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                  }`}>
                    {bot.status}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Client:</span>
                    <span className="text-slate-900 dark:text-white font-medium">{bot.clientName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Type:</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${getTypeBadge(bot.type).bg}`}>
                      {getTypeBadge(bot.type).icon}
                      {bot.type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Users:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {formatNumber(bot.totalUsers)} ({bot.activeUsers} active)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Tokens:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {formatNumber(bot.usedTokens)} used
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Calls:</span>
                    <span className="text-slate-900 dark:text-white font-medium">{formatNumber(bot.totalCalls)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Call Duration:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {formatDuration(bot.totalCallDuration)} (Avg: {(bot.avgCallDuration || 0).toFixed(1)}s)
                    </span>
                  </div>
                  <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Client ID:</span>
                      <span className="text-slate-900 dark:text-white font-mono">{bot.clientId}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-slate-500 dark:text-slate-400">Last Activity:</span>
                      <span className="text-slate-900 dark:text-white">{bot.lastActivity}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filteredBots.length === 0 && !loading && (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-8 text-center">
                <p className="text-slate-600 dark:text-slate-400">No bots found</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {filteredBots.length > 0 && (
            <div className="mt-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Showing {(effectiveBotsPage - 1) * PAGE_SIZE + 1}–{Math.min(effectiveBotsPage * PAGE_SIZE, filteredBots.length)} of {filteredBots.length} bot{filteredBots.length !== 1 ? 's' : ''}
              </p>
              {botsTotalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBotsPage(Math.max(1, effectiveBotsPage - 1))}
                    disabled={effectiveBotsPage <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{effectiveBotsPage} / {botsTotalPages}</span>
                  <button
                    onClick={() => setBotsPage(Math.min(botsTotalPages, effectiveBotsPage + 1))}
                    disabled={effectiveBotsPage >= botsTotalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Clients Tab Content */}
      {activeTab === 'clients' && (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                </colgroup>
                <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      CLIENT NAME
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      BOTS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      USERS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      TOKENS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      CALLS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      CALL DURATION
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      <div className="flex items-center gap-1.5">
                        CREDIT BALANCE
                        <button
                          onClick={(e) => { e.stopPropagation(); refreshBalance(); }}
                          disabled={refreshingBalance}
                          className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                          title="Refresh credit balance"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${refreshingBalance ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      STATUS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {pagedClients.map((client) => {
                    const clientBots = getClientBots(client.clientId);
                    return (
                      <React.Fragment key={client.clientId}>
                        <tr
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                          onClick={() => toggleClientExpand(client.clientId)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                  {client.clientName}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                                  {client.clientId}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-slate-900 dark:text-white">
                              <div className="font-medium">
                                {client.totalBots} bot{client.totalBots !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white">
                          <div className="font-medium">{formatNumber(client.totalUsers)}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {client.activeUsers} active
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white font-medium">
                          {formatNumber(client.totalUsedTokens)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">tokens used</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">
                        {formatNumber(client.totalCalls)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white">
                          <div className="font-medium">{formatDuration(client.totalCallDuration)}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Avg: {(client.avgCallDuration || 0).toFixed(1)}s
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {client.creditBalance ? (
                          <div className="text-sm">
                            <div className="text-slate-900 dark:text-white font-medium">
                              {Number(client.creditBalance.balance_credits).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              of {Number(client.creditBalance.total_credits).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} total
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            client.status === 'active'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                          }`}>
                            {client.status}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleClientExpand(client.clientId);
                            }}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                          >
                            {expandedClients.includes(client.clientId) ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedClients.includes(client.clientId) && clientBots.length > 0 && (
                      <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                        <td colSpan="8" className="px-4 py-4">
                          <div className="mb-3">
                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                              <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                              Bots for {client.clientName} ({clientBots.length})
                            </h4>
                          </div>
                          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                            {clientBots.map((bot) => (
                              <div
                                key={bot.botId}
                                className="flex-shrink-0 w-80 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <h5 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                          {bot.botName}
                                        </h5>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            copyToClipboard(bot.botId, bot.botId);
                                          }}
                                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors flex-shrink-0"
                                          title="Copy Bot ID"
                                        >
                                          {copiedId === bot.botId ? (
                                            <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                          ) : (
                                            <Copy className="w-3 h-3 text-slate-400" />
                                          )}
                                        </button>
                                      </div>
                                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate mt-1">
                                        {bot.botId}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${getTypeBadge(bot.type).bg}`}>
                                      {getTypeBadge(bot.type).icon} {bot.type}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                      bot.status === 'active'
                                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                        : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                                    }`}>
                                      {bot.status}
                                    </span>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                                  <div>
                                    <div className="text-slate-500 dark:text-slate-400">Users</div>
                                    <div className="text-slate-900 dark:text-white font-semibold">
                                      {formatNumber(bot.totalUsers)} ({bot.activeUsers} active)
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-500 dark:text-slate-400">Calls</div>
                                    <div className="text-slate-900 dark:text-white font-semibold">
                                      {formatNumber(bot.totalCalls)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-500 dark:text-slate-400">Tokens</div>
                                    <div className="text-slate-900 dark:text-white font-semibold">
                                      {formatNumber(bot.usedTokens)} used
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-slate-500 dark:text-slate-400">Duration</div>
                                    <div className="text-slate-900 dark:text-white font-semibold">
                                      {formatDuration(bot.totalCallDuration)}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      Avg: {(bot.avgCallDuration || 0).toFixed(1)}s
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
                                  <div className="text-slate-500 dark:text-slate-400">Last Activity:</div>
                                  <div className="text-slate-900 dark:text-white">{bot.lastActivity}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {filteredClients.length} client(s) found
              </p>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-3">
            {pagedClients.map((client) => {
              const clientBots = getClientBots(client.clientId);
              return (
                <div
                  key={client.clientId}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {client.clientName}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1 break-all">
                          {client.clientId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        client.status === 'active'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                      }`}>
                        {client.status}
                      </span>
                      <button
                        onClick={() => toggleClientExpand(client.clientId)}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                      >
                        {expandedClients.includes(client.clientId) ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </div>
                  </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Bots:</span>
                    <span className="text-slate-900 dark:text-white font-medium">{client.totalBots}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                    {client.bots.join(', ')}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Users:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {formatNumber(client.totalUsers)} ({client.activeUsers} active)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Tokens:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {formatNumber(client.totalUsedTokens)} used
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Calls:</span>
                    <span className="text-slate-900 dark:text-white font-medium">{formatNumber(client.totalCalls)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Call Duration:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {formatDuration(client.totalCallDuration)} (Avg: {(client.avgCallDuration || 0).toFixed(1)}s)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Credit Balance:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {client.creditBalance
                        ? Number(client.creditBalance.balance_credits).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                {/* Expanded Bots Section */}
                {expandedClients.includes(client.clientId) && clientBots.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                      <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      Bots ({clientBots.length})
                    </h4>
                    <div className="space-y-3">
                      {clientBots.map((bot) => (
                        <div
                          key={bot.botId}
                          className="bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 p-3"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h5 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                    {bot.botName}
                                  </h5>
                                  <button
                                    onClick={() => copyToClipboard(bot.botId, bot.botId)}
                                    className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                                    title="Copy Bot ID"
                                  >
                                    {copiedId === bot.botId ? (
                                      <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-slate-400" />
                                    )}
                                  </button>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5">
                                  {bot.botId}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${getTypeBadge(bot.type).bg}`}>
                                {getTypeBadge(bot.type).icon}
                                {bot.type}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                bot.status === 'active'
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                              }`}>
                                {bot.status}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                            <div>
                              <div className="text-slate-500 dark:text-slate-400">Users</div>
                              <div className="text-slate-900 dark:text-white font-semibold">
                                {formatNumber(bot.totalUsers)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 dark:text-slate-400">Calls</div>
                              <div className="text-slate-900 dark:text-white font-semibold">
                                {formatNumber(bot.totalCalls)}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 dark:text-slate-400">Tokens</div>
                              <div className="text-slate-900 dark:text-white font-semibold text-xs">
                                {formatNumber(bot.usedTokens)} used
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 dark:text-slate-400">Duration</div>
                              <div className="text-slate-900 dark:text-white font-semibold text-xs">
                                {formatDuration(bot.totalCallDuration)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
            })}
            {filteredClients.length === 0 && !loading && (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 p-8 text-center">
                <p className="text-slate-600 dark:text-slate-400">No clients found</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {filteredClients.length > 0 && (
            <div className="mt-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800/50 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Showing {(effectiveClientsPage - 1) * PAGE_SIZE + 1}–{Math.min(effectiveClientsPage * PAGE_SIZE, filteredClients.length)} of {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
              </p>
              {clientsTotalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setClientsPage(Math.max(1, effectiveClientsPage - 1))}
                    disabled={effectiveClientsPage <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{effectiveClientsPage} / {clientsTotalPages}</span>
                  <button
                    onClick={() => setClientsPage(Math.min(clientsTotalPages, effectiveClientsPage + 1))}
                    disabled={effectiveClientsPage >= clientsTotalPages}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default UserManagement;
