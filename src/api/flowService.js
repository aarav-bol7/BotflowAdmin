import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';

// Track A2: once-per-session deprecation warnings for legacy endpoint funcs.
// Kept for any unmigrated consumer (e.g., DeletedBots.jsx) to nudge migration.
const _deprecationWarned = new Set();
const _warnOnceDeprecation = (fnName, target) => {
  if (_deprecationWarned.has(fnName)) return;
  _deprecationWarned.add(fnName);
  console.warn(
    `[DEPRECATED] flowService.${fnName} — migrate to ${target}. ` +
    `Legacy endpoint preserved for unmigrated consumers; removal in post-A2 cleanup track.`
  );
};

// Track A2: adapter that converts a row from the unified /bot-analytics/bots/
// response shape into the legacy /flows/ shape used by Bot.jsx.
// The only shape delta is `lastMessage`: legacy emits a string; unified emits
// an object. Map via the flat `lastMessageContent` alias the matrix ships.
const _adaptRow = (row) => {
  if (row && row.lastMessage && typeof row.lastMessage === 'object') {
    return {
      ...row,
      lastMessage: row.lastMessageContent != null
        ? row.lastMessageContent
        : (row.lastMessage.content || ''),
    };
  }
  return row;
};

// Track A2: merge the /bots/ and /summary/ unified responses into the legacy
// envelope shape {flows, deletedFlows, total, page, pageSize, grandTotal*}
// that Bot.jsx's existing render code expects. No Bot.jsx change required.
const _adaptToLegacyEnvelope = (unifiedBots, unifiedSummary) => {
  const src = Array.isArray(unifiedBots.flows)
    ? unifiedBots.flows
    : (Array.isArray(unifiedBots.bots) ? unifiedBots.bots : []);
  const deleted = Array.isArray(unifiedBots.deletedFlows) ? unifiedBots.deletedFlows : [];
  const s = unifiedSummary || {};
  return {
    flows: src.map(_adaptRow),
    deletedFlows: deleted.map(_adaptRow),
    deletedTotal: unifiedBots.deletedTotal || 0,
    total: unifiedBots.total || 0,
    page: unifiedBots.page || 1,
    pageSize: unifiedBots.pageSize || 20,
    grandTotalPromptTokens:     s.grandTotalPromptTokens     || 0,
    grandTotalCompletionTokens: s.grandTotalCompletionTokens || 0,
    grandTotalTokens:           s.grandTotalTokens           || 0,
    grandTotalCalls:            s.grandTotalCalls            || 0,
    grandTotalPulses:           s.grandTotalPulses           || 0,
    grandTotalCallDuration:     s.grandTotalCallDuration     || 0,
    grandTotalTexts:            s.grandTotalTexts            || 0,
    grandTotalCredits:          s.grandTotalCredits          || 0,
    grandTotalUsers:            s.grandTotalUsers            || 0,
  };
};

export const flowService = {
  /**
   * Track A2: canonical flow-list fetcher.
   *
   * Queries /api/admin-panel/bot-analytics/bots/?include_deleted=1 and
   * /api/admin-panel/bot-analytics/summary/?include_deleted=1 in parallel,
   * then adapts to the legacy `/flows/` envelope so Bot.jsx's render code
   * is unchanged. Summary failure degrades gracefully to zero grand totals.
   */
  getFlowsUnified: async ({ search = '', page = 1, pageSize = 20, startDate, endDate } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      include_deleted: '1',
    });
    if (search) params.set('search', search);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const qs = params.toString();

    const botsPromise = (async () => {
      const r = await authenticatedFetch(
        `${DYNAMICADK_BASE_URL}/api/admin-panel/bot-analytics/bots/?${qs}`,
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch bots (${r.status})`);
      }
      return r.json();
    })();

    // Summary is best-effort: its failure must not block the list.
    const summaryPromise = (async () => {
      try {
        const r = await authenticatedFetch(
          `${DYNAMICADK_BASE_URL}/api/admin-panel/bot-analytics/summary/?${qs}`,
        );
        if (!r.ok) return {};
        return await r.json();
      } catch (err) {
        console.warn('[Track A2] summary fetch failed; grandTotals will show zero', err);
        return {};
      }
    })();

    const [bots, summary] = await Promise.all([botsPromise, summaryPromise]);
    return _adaptToLegacyEnvelope(bots, summary);
  },

  /**
   * @deprecated Track A2 — use getFlowsUnified(). Legacy endpoint is still
   * served by DynamicADK for unmigrated consumers; removal is scheduled for
   * the post-A2 cleanup track.
   */
  getFlows: async ({ search = '', page = 1, pageSize = 20, startDate, endDate } = {}) => {
    _warnOnceDeprecation('getFlows', 'flowService.getFlowsUnified');
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (search) params.set('search', search);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);

    // Full URL so authenticatedFetch doesn't prepend the auth-service base URL.
    // No tenant_id — backend returns all flows across all tenants (super-admin).
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/flows/?${params.toString()}`
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch flows (${response.status})`);
    }

    return response.json();
  },

  setStatus: async (botKey, tenantId, status) => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/set-status/`,
      {
        method: 'POST',
        body: JSON.stringify({ bot_key: botKey, tenant_id: tenantId, status }),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to update status (${response.status})`);
    }
    return response.json();
  },

  getProviders: async () => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/llm/providers/`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch providers (${response.status})`);
    }
    return response.json();
  },

  getFlowConfig: async (flowId, tenantId) => {
    const params = new URLSearchParams({ flow_id: flowId, tenant_id: tenantId });
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/flows/config/?${params.toString()}`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch flow config (${response.status})`);
    }
    return response.json();
  },

  // PATCH a single DB node's per-flow operational params (top_k, description).
  // Empty body or empty-valued fields clear the corresponding keys on the
  // node.data per the omit-empty rules; the cascade then falls back to GD.
  updateFlowDatabaseNode: async (flowId, nodeId, tenantId, body) => {
    const url = `${DYNAMICADK_BASE_URL}/api/admin-panel/flows/${encodeURIComponent(flowId)}/database-nodes/${encodeURIComponent(nodeId)}/`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, ...(body || {}) }),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `Failed to update DB node (${response.status})`);
    }
    return response.json();
  },

  getGlobalDefaults: async () => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/llm/global-defaults/`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch global defaults (${response.status})`);
    }
    return response.json();
  },

  updateGlobalDefaults: async (data) => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/llm/global-defaults/`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to update global defaults (${response.status})`);
    }
    return response.json();
  },

  getBillingConfig: async () => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/billing-config/`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch billing config (${response.status})`);
    }
    return response.json();
  },

  updateBillingConfig: async (data) => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/billing-config/`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to update billing config (${response.status})`);
    }
    return response.json();
  },

  getBotConfig: async (botKey, tenantId) => {
    const params = new URLSearchParams({ bot_key: botKey, tenant_id: tenantId });
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/config/?${params.toString()}`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to fetch bot config (${response.status})`);
    }
    return response.json();
  },

  updateBotConfig: async (data) => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/config/`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to update bot config (${response.status})`);
    }
    return response.json();
  },

  bulkSetStatus: async (bots, status) => {
    // bots = [{ botKey, tenantId }, ...]
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/bulk-set-status/`,
      {
        method: 'POST',
        body: JSON.stringify({
          bots: bots.map(b => ({ bot_key: b.botKey, tenant_id: b.tenantId })),
          status,
        }),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to bulk update status (${response.status})`);
    }
    return response.json();
  },

  deleteBot: async (botKey, tenantId) => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/delete/`,
      {
        method: 'POST',
        body: JSON.stringify({ bot_key: botKey, tenant_id: tenantId }),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to delete bot (${response.status})`);
    }
    return response.json();
  },

  bulkDeleteBots: async (bots) => {
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/bulk-delete/`,
      {
        method: 'POST',
        body: JSON.stringify({
          bots: bots.map(b => ({ bot_key: b.botKey, tenant_id: b.tenantId })),
        }),
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to bulk delete bots (${response.status})`);
    }
    return response.json();
  },

  listDeletedBots: async (tenantId) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenant_id', tenantId);
    const qs = params.toString();
    const response = await authenticatedFetch(
      `${DYNAMICADK_BASE_URL}/api/admin-panel/bots/deleted/${qs ? `?${qs}` : ''}`
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Failed to list deleted bots (${response.status})`);
    }
    return response.json();
  },
};

export default flowService;
