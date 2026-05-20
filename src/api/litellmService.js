// LiteLLM gateway client — used only by MultiLLM Chat page.
//
// In dev we hit the relative path '/litellm/v1/models' so the Vite proxy
// (vite.config.js) forwards to the real gateway and CORS doesn't fire.
// In production the deployed admin host must serve /litellm/* itself
// (reverse proxy) or the gateway must allow the admin origin via CORS.

const TOKEN = import.meta.env.VITE_LITELLM_TOKEN;
const RAW_BASE = import.meta.env.VITE_LITELLM_BASE_URL || '';

// If a base URL is configured, use it directly (production); otherwise rely
// on the dev proxy mounted at '/litellm'.
const BASE = RAW_BASE && !import.meta.env.DEV
  ? RAW_BASE.replace(/\/+$/, '')
  : '/litellm';

export class MissingTokenError extends Error {
  constructor() {
    super('VITE_LITELLM_TOKEN is not set in .env');
    this.name = 'MissingTokenError';
  }
}

const messageForStatus = (status) => {
  if (status === 401 || status === 403) return 'Invalid LiteLLM token';
  if (status === 404) return 'Endpoint not found — check VITE_LITELLM_BASE_URL';
  if (status >= 500) return 'LiteLLM service error (try again)';
  return `Request failed (${status})`;
};

export const litellmService = {
  listModels: async () => {
    if (!TOKEN) throw new MissingTokenError();

    let res;
    try {
      res = await fetch(`${BASE}/v1/models`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
    } catch (e) {
      const err = new Error('Network or CORS error — check browser console');
      err.cause = e;
      throw err;
    }

    if (!res.ok) {
      const err = new Error(messageForStatus(res.status));
      err.status = res.status;
      throw err;
    }

    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.data)) {
      throw new Error('Unexpected response from LiteLLM');
    }
    return json.data;
  },
};

export default litellmService;
