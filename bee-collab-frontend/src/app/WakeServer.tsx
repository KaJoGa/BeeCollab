'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

// Free hosting (Render + Neon) sleeps when idle. Mounted once in the root layout,
// this pings GET /health on every full page load — home, login, or a direct
// /meeting/<id> link — and keeps retrying until the backend and DB both answer.
// The first calls during a cold start may fail (503 / CORS error from the host's
// wake-up page), which is expected, hence the retry loop.

const RETRY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10000;
const SHOW_BANNER_AFTER_MS = 2000;

const getApiBase = () => {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.trim()) return env.replace(/\/+$/, '');
  return `http://${window.location.hostname}:3000`;
};

export default function WakeServer() {
  const { t } = useI18n();
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const bannerTimer = setTimeout(() => {
      if (!cancelled) setWaking(true);
    }, SHOW_BANNER_AFTER_MS);

    const finish = () => {
      cancelled = true;
      clearTimeout(bannerTimer);
      setWaking(false);
    };

    const ping = async () => {
      if (cancelled) return;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${getApiBase()}/health`, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          const data = json?.data ?? json;
          if (data?.db === 'up') {
            finish();
            return;
          }
        }
      } catch {
        // server still waking up — retry below
      } finally {
        clearTimeout(abortTimer);
      }
      if (!cancelled) retryTimer = setTimeout(ping, RETRY_MS);
    };

    ping();

    return () => {
      cancelled = true;
      clearTimeout(bannerTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  if (!waking) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="wake-server-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        padding: '0.5rem 1rem',
        textAlign: 'center',
        fontSize: '0.875rem',
        background: '#fef7e0',
        color: '#5f4b00',
        borderBottom: '1px solid #f9e0a0',
      }}
    >
      {t('wakeBanner')}
    </div>
  );
}
