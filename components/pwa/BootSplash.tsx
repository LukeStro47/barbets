'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { LoadingAnimation } from '@/components/ui/LoadingAnimation';

const FALLBACK_MS = 3000;
const FADE_MS = 300;
// launchAutoHide is off (capacitor.config.ts) so the native splash stays up until this fires
// instead of hiding on its own timer, leaving a hand-off gap. Belt-and-suspenders timeout below
// so a JS error or plugin load failure can't leave the native splash stuck forever.
const NATIVE_HIDE_FALLBACK_MS = 4000;

/**
 * One-shot splash shown while the app cold-starts (mounted once by the root
 * layout, which doesn't remount on client-side navigation, so this never
 * reappears between in-app page transitions). Hides on a fixed timeout.
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
    // rAF so this fires right after the loader above has actually painted, not before.
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
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#EDE9E0] transition-opacity duration-300 ${
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <LoadingAnimation />
    </div>
  );
}
