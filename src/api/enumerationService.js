/**
 * Track E: shared tenant & bot-by-tenant enumeration with TTL + LRU cache,
 * in-flight de-dup, and WS-driven invalidation.
 *
 * Consumers: BotAnalytics, Notifications, CallDetails, ChatMessages.
 * Legacy per-service getTenants() / getBots(tenantId) functions are kept
 * with deprecation markers; removal is a follow-up cleanup track.
 *
 * Cache coherency:
 *   - TTL 60s per entry.
 *   - LRU cap 20 entries (oldest evicted on insert past cap).
 *   - In-flight de-dup: parallel callers with same cache key await the
 *     same fetch promise.
 *   - Generation counter: if `invalidateAll()` fires WHILE a fetch is in
 *     flight, the fetch resolves but the result is NOT written to cache
 *     (prevents seeding a stale entry post-invalidation).
 *   - Invalidation is debounced 300ms (trailing edge) so bulk
 *     `bot.created`/`bot.deleted` events collapse to one cache clear.
 *   - WS subscription attached on first module import; never cleaned up
 *     (module lifetime == tab lifetime — acceptable).
 */
import { authenticatedFetch } from '../utils/adminAuthUtils';
import { DYNAMICADK_BASE_URL } from '../config/api';
import { botflowWs } from './botflowWebSocket';

const BASE = `${DYNAMICADK_BASE_URL}/api/admin-panel`;

const TTL_MS = 60_000;
const LRU_LIMIT = 20;
const INVALIDATION_DEBOUNCE_MS = 300;

// Map preserves insertion order — iteration yields oldest first for LRU eviction.
const _cache = new Map(); // key -> { value, expiresAt }
const _inflight = new Map(); // key -> Promise
let _generation = 0;
let _debounceTimer = null;

function _keyTenants({ counts, startDate, endDate }) {
  const sortedCounts = (counts || '').split(',').map(s => s.trim()).filter(Boolean).sort();
  return `tenants:${sortedCounts.join(',')}:${startDate || ''}:${endDate || ''}`;
}

function _keyBots(tenantId, { startDate, endDate } = {}) {
  return `bots:${tenantId}:${startDate || ''}:${endDate || ''}`;
}

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return undefined;
  }
  // Touch for LRU: delete + re-insert moves to end (most recently used).
  _cache.delete(key);
  _cache.set(key, entry);
  return entry.value;
}

function _cachePut(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  // Evict oldest until under cap.
  while (_cache.size > LRU_LIMIT) {
    const oldestKey = _cache.keys().next().value;
    _cache.delete(oldestKey);
  }
}

async function _fetchJson(url) {
  const resp = await authenticatedFetch(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

function _buildQS(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  return p.toString();
}

/**
 * Fetch tenant enumeration. `counts` is comma-separated subset of
 * {bots, chat, calls, users}. Absent/empty → cheap enumeration (id + name).
 * @param {object} opts
 * @param {string} [opts.counts]
 * @param {string} [opts.startDate]
 * @param {string} [opts.endDate]
 */
export async function getTenants(opts = {}) {
  const key = _keyTenants(opts);
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;

  const existing = _inflight.get(key);
  if (existing) return existing;

  const genAtStart = _generation;
  const qs = _buildQS({
    counts: opts.counts,
    start_date: opts.startDate,
    end_date: opts.endDate,
  });
  const url = `${BASE}/tenants/${qs ? '?' + qs : ''}`;
  const promise = _fetchJson(url).finally(() => _inflight.delete(key));
  _inflight.set(key, promise);
  const value = await promise;
  // Generation guard — if invalidation fired during the fetch, drop the write.
  if (genAtStart === _generation) _cachePut(key, value);
  return value;
}

/**
 * Fetch bots for a specific tenant. Cached by (tenantId, startDate, endDate).
 */
export async function getBotsByTenant(tenantId, { startDate, endDate } = {}) {
  if (!tenantId) throw new Error('tenantId is required');
  const key = _keyBots(tenantId, { startDate, endDate });
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;

  const existing = _inflight.get(key);
  if (existing) return existing;

  const genAtStart = _generation;
  const qs = _buildQS({ start_date: startDate, end_date: endDate });
  const url = `${BASE}/tenants/${encodeURIComponent(tenantId)}/bots/${qs ? '?' + qs : ''}`;
  const promise = _fetchJson(url).finally(() => _inflight.delete(key));
  _inflight.set(key, promise);
  const value = await promise;
  if (genAtStart === _generation) _cachePut(key, value);
  return value;
}

/**
 * Immediate cache clear + generation bump.
 * Called internally by the debounced WS handler and exported for tests.
 */
export function invalidateAllImmediate() {
  _generation += 1;
  _cache.clear();
  _inflight.clear();
}

/**
 * Trailing-edge debounced invalidation. Bulk WS `bot.created`/`bot.deleted`
 * events collapse to a single cache clear after INVALIDATION_DEBOUNCE_MS.
 */
export function invalidateAll() {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    invalidateAllImmediate();
  }, INVALIDATION_DEBOUNCE_MS);
}

// WS subscription — attached on first module import; never torn down.
// Service is a singleton; tab lifetime = module lifetime.
botflowWs.on('bot.created', () => invalidateAll());
botflowWs.on('bot.deleted', () => invalidateAll());

// Test-only helpers (prefixed with `_` signal internal use).
export const _internal = {
  _cache,
  _inflight,
  getGeneration: () => _generation,
  clearState: () => {
    _cache.clear();
    _inflight.clear();
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    _generation = 0;
  },
};
