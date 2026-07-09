'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type Platform = 'checking' | 'ios' | 'android' | 'other' | 'installed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Device-aware "install Barbets" instructions — iOS never fires beforeinstallprompt (Safari has no native install button, only the Share sheet), while Chrome on Android does, so we offer a real one-tap install there when the browser makes it available and fall back to menu instructions otherwise. */
export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>('checking');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
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

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  if (platform === 'checking' || platform === 'installed' || platform === 'other') return null;

  return (
    <Card className="space-y-2">
      <p className="font-semibold text-espresso-800">Install Barbets</p>
      <p className="text-sm text-espresso-500">Add it to your home screen for the full app experience.</p>
      {platform === 'ios' ? (
        <ol className="ml-4 list-decimal space-y-1 text-sm text-espresso-600">
          <li>
            Tap the Share icon <span aria-hidden>􀈂</span> in Safari's toolbar
          </li>
          <li>Choose "Add to Home Screen"</li>
        </ol>
      ) : deferredPrompt ? (
        <Button size="sm" onClick={handleInstallClick}>
          Install app
        </Button>
      ) : (
        <ol className="ml-4 list-decimal space-y-1 text-sm text-espresso-600">
          <li>Tap the menu (⋮) in Chrome's toolbar</li>
          <li>Choose "Install app" or "Add to Home screen"</li>
        </ol>
      )}
    </Card>
  );
}
