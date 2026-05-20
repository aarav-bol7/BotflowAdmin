import { useEffect, useRef, useCallback } from 'react';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_ID = 'cf-turnstile-script';

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

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current) return;

      // Remove any previous widget
      if (widgetIdRef.current !== null) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
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
  }, [action, onToken]);

  const reset = useCallback(() => {
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  if (!TURNSTILE_SITE_KEY) {
    return (
      <p className="text-xs text-red-500 text-center">
        Missing VITE_TURNSTILE_SITE_KEY in .env
      </p>
    );
  }

  return <div ref={containerRef} />;
}

export { TurnstileWidget };
