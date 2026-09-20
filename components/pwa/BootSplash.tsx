'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { Logo } from '@/components/ui/Logo';

const FALLBACK_MS = 3000;
const FADE_MS = 300;
const NATIVE_HIDE_FALLBACK_MS = 4000;

/**
 * Cold-open splash (DESIGN 5a): ink full-bleed, centred wordmark, three-dot pulse.
 * Mounted once by the root layout; never reappears on in-app navigations.
 */
export function BootSplash() {
  const [mounted, setMounted] = useState(true);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      SplashScreen.hide();
    };
    requestAnimationFrame(hide);
    const fallback = setTimeout(hide, NATIVE_HIDE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, []);

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
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-ink transition-opacity duration-300 ${
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <Logo height={36} className="text-white" />
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-bb-pulse rounded-full bg-white" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bb-pulse rounded-full bg-white" style={{ animationDelay: '160ms' }} />
        <span className="h-2 w-2 animate-bb-pulse rounded-full bg-white" style={{ animationDelay: '320ms' }} />
      </div>
    </div>
  );
}
