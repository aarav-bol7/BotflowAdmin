import { useEffect, useRef, useCallback, useState } from 'react';
import API_BASE_URL from '../config/api';

const ENV_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_ID = 'cf-turnstile-script';

// Domains are spread across a pool of Cloudflare Turnstile widgets, so the
// correct site key depends on which hostname we're served from. A single
// hardcoded VITE_TURNSTILE_SITE_KEY is domain-locked and fails on the admin
// host — resolve the right key per hostname from the auth backend (the same
// endpoint frontend-chatbot uses), and keep the env value only as a fallback.
const siteKeyCache = new Map();

function resolveSiteKey() {
  const host = (typeof window !== 'undefined' && window.location.hostname) || '';
  if (siteKeyCache.has(host)) return siteKeyCache.get(host);

  const base = (API_BASE_URL || '').replace(/\/$/, '');
  const url = `${base}/api/turnstile/site-key/?domain=${encodeURIComponent(host)}`;

  const promise = fetch(url, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => (data && data.site_key) || ENV_SITE_KEY || '')
    .catch(() => ENV_SITE_KEY || '');

  siteKeyCache.set(host, promise);
  return promise;
}

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    if (document.getElementById(SCRIPT_ID)) {
      // Script tag exists but not loaded yet — wait for it
      const check = setInterval(() => {
        if (window.turnstile) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({ onToken, action }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [siteKey, setSiteKey] = useState(null);

  // Resolve the site key for this hostname before rendering the widget.
  useEffect(() => {
    let cancelled = false;
    resolveSiteKey().then((key) => {
      if (!cancelled) setSiteKey(key || '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current) return;

      // Remove any previous widget
      if (widgetIdRef.current !== null) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        size: 'flexible',
        action: action || undefined,
        callback: (token) => onToken?.(token),
        'expired-callback': () => onToken?.(null),
        'error-callback': () => onToken?.(null),
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [action, onToken, siteKey]);

  const reset = useCallback(() => {
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  if (siteKey === null) {
    return null; // resolving — render nothing briefly
  }

  if (!siteKey) {
    return (
      <p className="text-xs text-red-500 text-center">
        Turnstile site key unavailable for this domain
      </p>
    );
  }

  return <div ref={containerRef} />;
}

export { TurnstileWidget };
