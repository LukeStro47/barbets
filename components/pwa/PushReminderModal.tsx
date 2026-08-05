'use client';

import { useEffect, useState } from 'react';
import { usePushSubscription } from '@/components/pwa/usePushSubscription';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

const LAST_SHOWN_KEY = 'barbets-push-reminder-last-shown';
export const JUST_JOINED_GROUP_KEY = 'barbets-just-joined-group';
const REPROMPT_DAYS = 7;

/** Nudges anyone who opens the app without a working push subscription — covers both "never
 * turned it on" and the on-device-but-server-lost-the-row case usePushSubscription self-heals
 * on mount. Shows immediately after joining/creating a first group (JUST_JOINED_GROUP_KEY, set
 * by JoinFlow/CreateGroupForm right before their redirect), and otherwise at most once every
 * REPROMPT_DAYS on ordinary app opens — a previous version of this modal showed on every open
 * and closed itself the instant the async subscription check resolved, which for anyone already
 * subscribed looked like a flash of a modal popping up and vanishing. Gated on `subscribedKnown`
 * here so it never opens before that check has actually settled. */
export function PushReminderModal() {
  const { platform, subscribed, subscribedKnown, permission, isPending, error, subscribe } = usePushSubscription();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!subscribedKnown || subscribed) return;
    if (platform !== 'ready' && platform !== 'ios-needs-install') return;
    // Already permanently blocked at the OS/browser level — nothing this modal offers is
    // actionable, requestPermission() would just re-return 'denied' instantly.
    if (permission === 'denied') return;

    const justJoined = localStorage.getItem(JUST_JOINED_GROUP_KEY) === '1';
    const lastShown = Number(localStorage.getItem(LAST_SHOWN_KEY) ?? 0);
    const dueForReprompt = Date.now() - lastShown > REPROMPT_DAYS * 24 * 60 * 60 * 1000;
    if (!justJoined && !dueForReprompt) return;

    localStorage.removeItem(JUST_JOINED_GROUP_KEY);
    localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
    setOpen(true);
  }, [subscribedKnown, subscribed, platform, permission]);

  // Close automatically once subscribe() succeeds, rather than waiting for the user to notice
  // and dismiss it themselves.
  useEffect(() => {
    if (subscribed) setOpen(false);
  }, [subscribed]);

  if (!open) return null;

  function dismiss() {
    setOpen(false);
  }

  return (
    <Modal onClose={dismiss}>
      <p className="font-display font-bold text-espresso-900">Turn on notifications?</p>
      {platform === 'ios-needs-install' ? (
        <p className="text-sm text-espresso-500">
          Install Barbets to your home screen to get notifications on iPhone/iPad: open the Share menu and choose
          "Add to Home Screen," then reopen it from there.
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
