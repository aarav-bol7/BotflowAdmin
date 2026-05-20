import API_BASE_URL from '../config/api';

const AUTH_BASE_URL = `${API_BASE_URL}/api/auth`;
const DASHBOARD_TYPE = import.meta.env.VITE_DASHBOARD_TYPE || 'admin';

const ENDPOINTS = {
  SEND_OTP: `${AUTH_BASE_URL}/send-otp/`,
  LOGIN: `${AUTH_BASE_URL}/verify-otp/`,
  ME: `${AUTH_BASE_URL}/me/`,
  LOGOUT: `${AUTH_BASE_URL}/logout/`,
};

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const normalizePayload = (data) => {
  if (!data || typeof data !== 'object') return {};
  return data.data ?? data;
};

const handleApiResponse = async (response) => {
  const responseBody = await parseJsonSafe(response);

  if (response.ok) {
    return responseBody;
  }

  const errorMessage =
    responseBody.message ||
    responseBody.error ||
    responseBody?.error_details?.error ||
    `Request failed with status ${response.status}`;

  if (
    errorMessage.toLowerCase().includes('deactivated') ||
    errorMessage.toLowerCase().includes('account is deactivated')
  ) {
    throw new Error('Your account has been deactivated. Please contact the administrator.');
  }

  if (
    errorMessage.toLowerCase().includes('user not found') ||
    errorMessage.toLowerCase().includes('user does not exist')
  ) {
    throw new Error('User not found. No account exists with this identifier. Please sign up first.');
  }

  if (
    errorMessage.toLowerCase().includes('invalid otp') ||
    errorMessage.toLowerCase().includes('incorrect otp')
  ) {
    throw new Error('Invalid OTP. Please check and try again.');
  }

  throw new Error(errorMessage);
};

const authFetch = (url, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Dashboard-Type': DASHBOARD_TYPE,
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
};

const buildAuthBaseCandidates = () => {
  const fromEnv = import.meta.env.VITE_AUTH_API_URL;
  const candidates = [
    AUTH_BASE_URL,
    fromEnv ? `${String(fromEnv).replace(/\/+$/, '')}/api/auth` : null,
    `${API_BASE_URL}/api/auth`,
    'http://127.0.0.1:8008/api/auth',
    'http://localhost:8008/api/auth',
    'http://127.0.0.1:8004/api/auth',
    'http://localhost:8004/api/auth',
  ].filter(Boolean);

  return [...new Set(candidates)];
};

export const authService = {
  sendOtp: async (identifier, purpose, turnstileToken) => {
    const response = await authFetch(ENDPOINTS.SEND_OTP, {
      method: 'POST',
      body: JSON.stringify({
        email: identifier,
        whatsappNumber: identifier,
        purpose,
        turnstile_token: turnstileToken,
      }),
    });
    return handleApiResponse(response);
  },

  login: async (identifier, otp, otpRequestUuid) => {
    const payload = {
      identifier,
      otp,
      email: identifier,
      purpose: 'login',
    };
    if (otpRequestUuid) payload.otp_request_uuid = otpRequestUuid;
    const response = await authFetch(ENDPOINTS.LOGIN, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return handleApiResponse(response);
  },

  me: async () => {
    let lastError = null;

    for (const base of buildAuthBaseCandidates()) {
      try {
        const response = await authFetch(`${base}/me/`, { method: 'GET' });
        const data = await handleApiResponse(response);
        return normalizePayload(data);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Unable to fetch current user profile');
  },

  logout: async () => {
    const response = await authFetch(ENDPOINTS.LOGOUT, { method: 'POST' });
    return handleApiResponse(response);
  },
};

export default authService;
