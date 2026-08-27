'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export type InstallPlatform = 'checking' | 'ios' | 'android' | 'other' | 'installed';

/** Platform/installed detection. The two components that used to render browser install
 * instructions from this, InstallPrompt and InstallBanner, are gone (see ARCHITECTURE.md's "PWA &
 * push"), but the detection itself is still load-bearing: PushReminderModal uses `platform ===
 * 'installed'` to gate asking for push until the app is actually installed. */
export function useInstallPrompt() {
  const [platform, setPlatform] = useState<InstallPlatform>('checking');

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
  }, []);

  return { platform };
}
