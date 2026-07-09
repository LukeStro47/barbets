'use client';

import { useState } from 'react';
import { usePushSubscription } from '@/components/pwa/usePushSubscription';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

const DISMISSED_KEY = 'barbets-push-reminder-dismissed';

/** Nudges anyone who opens the app without a working push subscription — covers both "never turned it on" and the on-device-but-server-lost-the-row case usePushSubscription self-heals on mount. */
export function PushReminderModal() {
  const { platform, subscribed, isPending, error, subscribe } = usePushSubscription();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && sessionStorage.getItem(DISMISSED_KEY) === '1'
  );

  const shouldOffer = platform === 'ready' || platform === 'ios-needs-install';
  if (dismissed || !shouldOffer || subscribed) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return (
    <Modal onClose={dismiss}>
      <p className="font-display font-bold text-espresso-900">Turn on notifications?</p>
      {platform === 'ios-needs-install' ? (
        <p className="text-sm text-espresso-500">
          Install Barbets to your home screen to get notifications on iPhone/iPad, open the Share menu and choose "Add
          to Home Screen," then reopen it from there.
        </p>
      ) : (
        <>
          <p className="text-sm text-espresso-500">
            Get notified when a market needs you, closes, or resolves. You can turn this off any time from your
            profile.
          </p>
          {error && <p className="text-sm text-danger-700">{error}</p>}
          <Button className="w-full" disabled={isPending} onClick={subscribe}>
            Enable notifications
          </Button>
        </>
      )}
      <Button variant="ghost" className="w-full" onClick={dismiss}>
        Not now
      </Button>
    </Modal>
  );
}
