'use client';

import { useEffect, useState } from 'react';
import { useInstallPrompt } from '@/components/pwa/useInstallPrompt';
import { Button } from '@/components/ui/Button';

const DISMISSED_KEY = 'barbets-install-banner-dismissed';

/** Compact, dismissible install nudge shown on the group page — the first real screen a new
 * member lands on after joining, unlike /profile which nothing points them to. Dismissal is
 * permanent (localStorage): unlike PushReminderModal, there's no server-verifiable "still not
 * installed" state to re-check, so re-showing it would just be nagging with no new information. */
export function InstallBanner() {
  const { platform, deferredPrompt, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');
  }, []);

  if (dismissed || platform === 'checking' || platform === 'installed' || platform === 'other') return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="relative space-y-2 rounded-2xl border border-honey-300/60 bg-honey-50 px-4 py-3.5 pr-10">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 rounded-full px-2 py-1 text-espresso-400 hover:text-espresso-700"
      >
        ×
      </button>
      <p className="text-sm font-semibold text-espresso-800">Install Barbets on your home screen</p>
      {platform === 'ios' ? (
        <p className="text-sm text-espresso-600">
          Tap the Share icon <span aria-hidden>􀈂</span> in Safari's toolbar, then choose "Add to Home Screen."
        </p>
      ) : deferredPrompt ? (
        <Button size="sm" onClick={promptInstall}>
          Install app
        </Button>
      ) : (
        <p className="text-sm text-espresso-600">Tap the menu (⋮) in Chrome's toolbar, then "Install app."</p>
      )}
    </div>
  );
}
