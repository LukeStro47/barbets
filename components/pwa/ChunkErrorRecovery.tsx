'use client';

import { useEffect } from 'react';

const RELOAD_KEY = 'chunk-error-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  return err.name === 'ChunkLoadError' || /Loading (chunk|CSS chunk) .* failed/i.test(err.message ?? '');
}

/**
 * A Vercel deploy replaces the previous build's chunk manifest outright, so an already-open tab
 * (a backgrounded PWA, or a browser tab left open across a release) that then makes a client-side
 * navigation can ask for a chunk that no longer exists on the server. That throw happens inside
 * webpack's own dynamic-import machinery, not inside a React render, so it reaches neither an
 * error boundary (global-error.tsx) nor a Server Action/route handler (instrumentation.ts) - it is
 * invisible to this app's error reporting, and without this component it leaves the user stuck on
 * whatever was on screen (often BootSplash) with no way forward except knowing to reload by hand.
 *
 * A single automatic reload fetches the current HTML and its current chunk manifest, which is
 * exactly what resolves the ordinary case (stale tab, new deploy). The sessionStorage cooldown
 * stops a genuinely broken deployment from reload-looping the tab forever.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    function recover() {
      const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      if (isChunkLoadError(event.error)) recover();
    }
    function onRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) recover();
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
