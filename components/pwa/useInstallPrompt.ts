'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export type InstallPlatform = 'checking' | 'ios' | 'android' | 'other' | 'installed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Shared by InstallPrompt (profile page) and InstallBanner (group page) so both agree on
 * platform/installed detection. iOS never fires `beforeinstallprompt` (Safari has no native
 * install button, only the Share sheet), while Chrome on Android does, so `deferredPrompt`
 * lets Android get a real one-tap install when the browser makes it available. */
export function useInstallPrompt() {
  const [platform, setPlatform] = useState<InstallPlatform>('checking');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already a real app in this context, no home-screen install to prompt for.
    if (Capacitor.isNativePlatform()) {
      setPlatform('installed');
      return;
    }

    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

    if (isStandalone) {
      setPlatform('installed');
      return;
    }
    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'other');

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  async function promptInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return { platform, deferredPrompt, promptInstall };
}
