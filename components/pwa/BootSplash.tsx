'use client';

import { useEffect, useState } from 'react';

const FALLBACK_MS = 3000;
const FADE_MS = 300;

/**
 * One-shot splash shown while the app cold-starts (mounted once by the root
 * layout, which doesn't remount on client-side navigation, so this never
 * reappears between in-app page transitions). `/loader.html` runs in its own
 * iframe document rather than being inlined, so its markup/script can't
 * collide with the app's own DOM. Hides on a fixed timeout rather than
 * waiting on any signal from the iframe, since a same-origin static file has
 * no reliable "done" event to listen for.
 */
export function BootSplash() {
  const [mounted, setMounted] = useState(true);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setExiting(true);
      return;
    }
    const timer = setTimeout(() => setExiting(true), FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [exiting]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-50 bg-[#EDE9E0] transition-opacity duration-300 ${
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <iframe src="/loader.html" title="" tabIndex={-1} className="h-full w-full border-0" />
    </div>
  );
}
