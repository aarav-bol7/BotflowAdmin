import API_BASE_URL from '../config/api';

const DASHBOARD_TYPE = import.meta.env.VITE_DASHBOARD_TYPE || 'admin';
const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'user_data';
const EXPIRY_KEY = 'auth_expiry_in_utc';
const LOGGED_OUT_KEY = 'logged_out';

const _deleteCookie = (name) => {
  try { document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`; } catch {}
};

let inMemoryAccessToken = null;
let inMemoryRefreshToken = null;
let _forceLogoutInProgress = false;
let _expiryWatcherInterval = null;
let _refreshInFlight = null;

const parseJwtUnsafe = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const setTokenExpiry = (accessToken, data = null) => {
  if (!accessToken) return;

  const explicitExpiry = data?.expiry_in_utc || data?.exp || null;
  if (explicitExpiry) {
    localStorage.setItem(EXPIRY_KEY, String(explicitExpiry));
    localStorage.setItem(accessToken, JSON.stringify({ expiry_in_utc: explicitExpiry }));
    return;
  }

  const decoded = parseJwtUnsafe(accessToken);
  if (decoded?.exp) {
    localStorage.setItem(EXPIRY_KEY, String(decoded.exp));
    localStorage.setItem(accessToken, JSON.stringify({ expiry_in_utc: decoded.exp }));
  }
};

const parseExpiry = (value) => {
  if (!value) return null;
  const num = Number(value);
  if (Number.isFinite(num) && num > 1e9) return num;
  // Handle ISO date strings (e.g. "2026-04-08T15:30:00+00:00")
  const ms = Date.parse(value);
  if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  return null;
};

const getStoredExpiry = (accessToken) => {
  const cached = localStorage.getItem(EXPIRY_KEY);
  const parsed = parseExpiry(cached);
  if (parsed) return parsed;

  if (!accessToken) return null;
  try {
    const tokenMeta = localStorage.getItem(accessToken);
    if (!tokenMeta) return null;
    const meta = JSON.parse(tokenMeta);
    return parseExpiry(meta?.expiry_in_utc) ?? null;
  } catch {
    return null;
  }
};

const getResponseData = (data) => (data?.data ?? data ?? {});

// ── Public API ──────────────────────────────────────────────────────────────

export const saveAuthTokens = (accessToken, refreshToken, userData = null, data = null) => {
  try {
    localStorage.removeItem(LOGGED_OUT_KEY);

    if (accessToken) {
      inMemoryAccessToken = accessToken;
      setTokenExpiry(accessToken, data);
    }

    if (refreshToken) {
      inMemoryRefreshToken = refreshToken;
    }

    const normalizedUser = userData ?? data?.user ?? null;
    if (normalizedUser && typeof normalizedUser === 'object') {
      localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));
    }
  } catch (error) {
    console.error('Error saving auth data:', error);
  }
};

// Alias for backward compatibility with existing admin code
export const saveAdminAuthTokens = saveAuthTokens;

export const getAccessToken = () => {
  try {
    if (inMemoryAccessToken) return inMemoryAccessToken;

    let token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);

    if (!token) {
      const altKeys = ['authToken', 'token'];
      for (const key of altKeys) {
        token = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (token) break;
      }
    }

    // Fallback: read access_token from cookie
    if (!token) {
      try {
        const match = document.cookie.split('; ').find(row => row.startsWith('access_token='));
        if (match) token = match.split('=').slice(1).join('=') || null;
      } catch {}
    }

    if (token) {
      inMemoryAccessToken = token;

      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('authToken');
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');

      return inMemoryAccessToken;
    }

    return null;
  } catch {
    return null;
  }
};

// Alias for backward compatibility
export const getAdminAccessToken = getAccessToken;

export const getRefreshToken = () => {
  try {
    if (inMemoryRefreshToken) return inMemoryRefreshToken;

    const legacyRefresh = localStorage.getItem(REFRESH_TOKEN_KEY) || sessionStorage.getItem(REFRESH_TOKEN_KEY);
    if (legacyRefresh) {
      inMemoryRefreshToken = legacyRefresh;
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      return inMemoryRefreshToken;
    }

    return null;
  } catch {
    return null;
  }
};

// Alias for backward compatibility
export const getAdminRefreshToken = getRefreshToken;

export const getUserData = () => {
  try {
    const userData = localStorage.getItem(USER_KEY);
    if (!userData) return null;

    const parsed = JSON.parse(userData);
    if (parsed && typeof parsed === 'object' && parsed.user && typeof parsed.user === 'object') {
      return parsed.user;
    }
    return parsed;
  } catch {
    return null;
  }
};

// Alias for backward compatibility
export const getAdminData = getUserData;

export const clearAuthData = () => {
  inMemoryAccessToken = null;
  inMemoryRefreshToken = null;
  _refreshInFlight = null;

  // Clear cookies
  _deleteCookie('access_token');
  _deleteCookie('refresh_token');
  _deleteCookie('channels_user_id');
  for (const dtype of ['admin', 'reseller', 'client']) {
    _deleteCookie(`access_token_${dtype}`);
    _deleteCookie(`refresh_token_${dtype}`);
  }

  // Clear localStorage
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) localStorage.removeItem(token);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EXPIRY_KEY);

  // Clear sessionStorage
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('token');
  } catch {}

  // Persistent flag — survives page refresh, prevents cookie re-auth
  localStorage.setItem(LOGGED_OUT_KEY, '1');
};

// Alias for backward compatibility
export const clearAdminAuthData = clearAuthData;

/**
 * Force-logout: clears all auth state and immediately redirects to /login.
 * Deduped so multiple concurrent 401s don't trigger multiple redirects.
 */
export const forceLogout = () => {
  if (_forceLogoutInProgress) return;
  _forceLogoutInProgress = true;
  stopTokenExpiryWatcher();
  clearAuthData();
  window.location.href = '/login';
};

export const isAuthenticated = () => {
  const token = getAccessToken();
  return Boolean(token);
};

// Alias for backward compatibility
export const isAdminAuthenticated = isAuthenticated;

export const isTokenExpired = () => {
  const token = getAccessToken();
  if (!token) return false;

  const expiry = getStoredExpiry(token);
  if (!expiry) return false;

  const now = Math.floor(Date.now() / 1000) - 10;
  return expiry <= now;
};

export const shouldRefreshToken = () => {
  const token = getAccessToken();
  if (!token) return false;

  const expiry = getStoredExpiry(token);
  if (!expiry) return false;

  const now = Math.floor(Date.now() / 1000);
  return (expiry - now) < 300;
};

export const getAuthHeader = () => {
  const token = getAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

export const refreshAccessToken = async () => {
  // Skip if we already have a valid non-expired token
  const existing = getAccessToken();
  if (existing && !isTokenExpired()) return existing;

  // Dedup concurrent callers — one network request, shared result
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    try {
      const response = await fetch(`${API_BASE_URL}/api/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Type': DASHBOARD_TYPE },
        credentials: 'include',
        body: JSON.stringify(refreshToken ? { refresh: refreshToken } : {}),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          inMemoryAccessToken = null;
          inMemoryRefreshToken = null;
          forceLogout();
        }
        return null;
      }

      const json = await response.json().catch(() => ({}));
      const data = getResponseData(json);

      const newAccess = data.access ?? data.access_token ?? null;
      const newRefresh = data.refresh ?? null;

      if (newAccess) {
        inMemoryAccessToken = newAccess;
        setTokenExpiry(newAccess, data);
        if (newRefresh) {
          inMemoryRefreshToken = newRefresh;
        }
        return newAccess;
      }

      return null;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
};

const fetchCurrentUser = async () => {
  try {
    const token = getAccessToken();
    const headers = { 'X-Dashboard-Type': DASHBOARD_TYPE };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API_BASE_URL}/api/auth/me/`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    if (!payload) return null;
    const user = getResponseData(payload);
    if (user && typeof user === 'object' && (user.id || user.user_id || user.email)) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    }
    return null;
  } catch {
    return null;
  }
};

export const validateAuthSession = async () => {
  const token = getAccessToken();

  if (token && !isTokenExpired()) {
    return true;
  }

  // Don't attempt cookie-based re-auth if user explicitly logged out
  if (localStorage.getItem(LOGGED_OUT_KEY)) {
    return false;
  }

  // Try refresh — works with refresh token OR httpOnly session cookies
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    return true;
  }

  // fetchCurrentUser can validate via HTTP-only cookies, but if we still
  // don't have a usable access token after it, APIs won't work — treat
  // as unauthenticated so the user is redirected to login.
  const user = await fetchCurrentUser();
  if (user) {
    const freshToken = getAccessToken();
    if (freshToken && !isTokenExpired()) {
      return true;
    }
  }

  return false;
};

export const authenticatedFetch = async (url, options = {}) => {
  const isFormData = options.body instanceof FormData;

  let token = getAccessToken();
  if (token && isTokenExpired()) {
    const rotated = await refreshAccessToken();
    if (rotated) {
      token = getAccessToken();
    }
  }

  const headers = { ...(options.headers || {}) };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;

  let response = await fetch(fullUrl, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      forceLogout();
      return response;
    }

    const retryHeaders = { ...headers };
    const retryToken = getAccessToken();
    if (retryToken) {
      retryHeaders.Authorization = `Bearer ${retryToken}`;
    } else {
      delete retryHeaders.Authorization;
    }

    response = await fetch(fullUrl, {
      ...options,
      headers: retryHeaders,
      credentials: 'include',
    });
  }

  return response;
};

/**
 * Calls the /api/auth/introspect/ endpoint to verify whether the current
 * access token is still active on the server (not just locally unexpired).
 * Returns true if active, false otherwise.
 */
const introspectToken = async (token) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/introspect/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) return false;

    const json = await response.json();
    const data = json?.data ?? json ?? {};
    return data.active === true;
  } catch {
    // Network error — don't force-logout on transient failures
    return true;
  }
};

/**
 * Starts a periodic watcher that polls the introspect endpoint to verify the
 * token is still active on the server. If the token is inactive (expired,
 * revoked, or blacklisted), forces logout and redirects to /login.
 *
 * Polling interval is configured via VITE_TOKEN_CHECK_INTERVAL (seconds).
 * Falls back to `intervalMs` parameter (default 30 000 ms).
 */
export const startTokenExpiryWatcher = (intervalMs = 30000) => {
  stopTokenExpiryWatcher();

  const envSeconds = Number(import.meta.env.VITE_TOKEN_CHECK_INTERVAL);
  const pollMs = envSeconds > 0 ? envSeconds * 1000 : intervalMs;

  _expiryWatcherInterval = setInterval(async () => {
    const token = getAccessToken();
    if (!token) return; // No token yet (e.g. on login page)

    const active = await introspectToken(token);
    if (!active) {
      console.warn('Token introspection returned inactive — forcing logout');
      forceLogout();
    }
  }, pollMs);
};

export const stopTokenExpiryWatcher = () => {
  if (_expiryWatcherInterval) {
    clearInterval(_expiryWatcherInterval);
    _expiryWatcherInterval = null;
  }
};

export const logout = async () => {
  const body = {};
  if (inMemoryAccessToken) body.access = inMemoryAccessToken;
  if (inMemoryRefreshToken) body.refresh = inMemoryRefreshToken;

  try {
    await fetch(`${API_BASE_URL}/api/auth/logout/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Type': DASHBOARD_TYPE },
      body: JSON.stringify(body),
    });
  } catch {
    // ignore network errors; local cleanup still required
  } finally {
    stopTokenExpiryWatcher();
    clearAuthData();
  }
};

// Alias for backward compatibility
export const adminLogout = logout;

export default {
  saveAuthTokens,
  saveAdminAuthTokens,
  getAccessToken,
  getAdminAccessToken,
  getRefreshToken,
  getAdminRefreshToken,
  getUserData,
  getAdminData,
  clearAuthData,
  clearAdminAuthData,
  forceLogout,
  isAuthenticated,
  isAdminAuthenticated,
  isTokenExpired,
  shouldRefreshToken,
  getAuthHeader,
  authenticatedFetch,
  refreshAccessToken,
  validateAuthSession,
  logout,
  adminLogout,
  startTokenExpiryWatcher,
  stopTokenExpiryWatcher,
};
