/**
 * Shared WS-reconnect catch-up helper (Track B).
 *
 * Usage: on the WS client's `reconnected` event, call
 * `performReconnectCatchup({wsClient, catchupFetch, fullRefetch, mergeFn, filters, abortSignal})`.
 *
 * Decision flow:
 *   - lastTs is null → skip catch-up, call fullRefetch (no baseline).
 *   - lastTs is suspiciously in the future → clamp to now - 5min (client-clock glitch).
 *   - response has truncated=true → fall back to fullRefetch; still advance baseline.
 *   - on 404/410 → surface to caller (domain-specific handling, e.g., deleted session).
 *   - on 401 → propagate (authenticatedFetch already handles refresh; persistent 401 surfaces).
 *   - on abort → return {status: 'skipped'}.
 *   - on other error → fallback to fullRefetch; do NOT advance baseline.
 */

const FUTURE_SKEW_MS = 5 * 60 * 1000;

export async function performReconnectCatchup({
  wsClient,
  catchupFetch,
  fullRefetch,
  mergeFn,
  filters = {},
  abortSignal,
}) {
  let lastTs = wsClient.getLastMessageTime();

  if (!lastTs) {
    await fullRefetch(filters);
    return { status: 'blind' };
  }

  // Future-skew clamp: if the client-stored baseline is more than 5 minutes
  // ahead of wall-clock now, the WS client's timestamp source was bad.
  // Clamp to now - 5min to avoid sending a since_ts the server can never
  // satisfy (would silently miss the gap).
  const lastTsMs = new Date(lastTs).getTime();
  if (!Number.isNaN(lastTsMs) && lastTsMs > Date.now() + FUTURE_SKEW_MS) {
    lastTs = new Date(Date.now() - FUTURE_SKEW_MS).toISOString();
  }

  try {
    const resp = await catchupFetch({ ...filters, since_ts: lastTs }, abortSignal);
    if (resp && resp.truncated === true) {
      await fullRefetch(filters);
      if (resp.server_ts) wsClient.setLastMessageTime(resp.server_ts);
      return { status: 'truncated' };
    }
    // Caller's mergeFn decides what to do with items (including empty lists —
    // e.g., CallDetails treats 0 items as "skip regroup").
    if (mergeFn) mergeFn((resp && resp.items) || []);
    if (resp && resp.server_ts) wsClient.setLastMessageTime(resp.server_ts);
    return { status: 'catchup' };
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
      return { status: 'skipped' };
    }
    if (error && (error.status === 404 || error.status === 410)) {
      // Caller must handle (e.g., ChatMessages chat-view: session deleted).
      return { status: 'error', error };
    }
    if (error && error.status === 401) {
      // authenticatedFetch handles refresh; if still 401, surface.
      throw error;
    }
    // Other failures (500, network) → blind fallback so user sees something.
    await fullRefetch(filters);
    return { status: 'blind', error };
  }
}

/**
 * Merge `incoming` rows into `existing`, deduping by `keyFn(row)`.
 * Returns { merged, addedCount }. Preserves `existing` order; prepends
 * genuinely-new rows at the front (descending time convention).
 */
export function mergeById(existing, incoming, keyFn = (row) => row.id) {
  if (!incoming || incoming.length === 0) {
    return { merged: existing, addedCount: 0 };
  }
  const seen = new Set(existing.map(keyFn));
  const additions = [];
  for (const row of incoming) {
    const key = keyFn(row);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    additions.push(row);
  }
  if (additions.length === 0) return { merged: existing, addedCount: 0 };
  return { merged: [...additions, ...existing], addedCount: additions.length };
}
