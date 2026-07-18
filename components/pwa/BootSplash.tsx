'use client';

import { useEffect, useRef, useState } from 'react';

const FALLBACK_MS = 3000;
const FADE_MS = 300;

/**
 * One-shot splash shown while the app cold-starts (mounted once by the root
 * layout, which doesn't remount on client-side navigation, so this never
 * reappears between in-app page transitions). Falls back to a fixed timeout
 * in case autoplay is blocked or the video fails to load.
 */
export function BootSplash() {
  const [mounted, setMounted] = useState(true);
  const [exiting, setExiting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const hide = () => setExiting(true);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      hide();
      return;
    }

    const timer = setTimeout(hide, FALLBACK_MS);
    const video = videoRef.current;
    video?.addEventListener('ended', hide);
    return () => {
      clearTimeout(timer);
      video?.removeEventListener('ended', hide);
    };
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
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-espresso-900 to-espresso-700 transition-opacity duration-300 ${
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <video ref={videoRef} src="/loading.mp4" autoPlay muted playsInline className="max-h-[40vh] max-w-[60vw] object-contain" />
    </div>
  );
}
