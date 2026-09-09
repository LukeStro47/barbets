'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { recordAppOpen } from '@/lib/actions/loginReward';
import { APP_OPEN_DAY_STORAGE_KEY, localDayString } from '@/lib/loginReward';

/**
 * Tells the server "this person opened the app today", in the device's own local day, for the
 * 7-day login reward streak (`record_app_open`). Renders nothing.
 *
 * A client component on purpose, mounted once in the signed-in app shell: `touch_last_active()`
 * next to it in the layout is a server-side stamp and can never know what calendar day it is where
 * the phone is (a 1am open after a night out is still that night to the person opening it). Deduped
 * per local day in localStorage so this is one call a day per device, not one per navigation, and
 * the server dedupes again on its side (a same-day repeat is a no-op there too).
 *
 * The check runs on mount, on every route change, and whenever the tab/PWA comes back into view,
 * because an installed app that stays open across midnight never remounts this component: without
 * the visibility hook a phone left on the groups hub overnight would only get tomorrow counted on
 * its next cold start. When the streak actually moved, the server-rendered figures that show it
 * (the profile card, the roster) are stale, so the router refreshes once.
 */
export function RecordAppOpen() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const today = localDayString();
      let lastReported: string | null = null;
      try {
        lastReported = localStorage.getItem(APP_OPEN_DAY_STORAGE_KEY);
      } catch {
        // Private mode / blocked storage: fall through and let the server dedupe.
      }
      if (lastReported === today) return;

      const result = await recordAppOpen(today);
      if (cancelled || result.error || !result.data) return;
      try {
        localStorage.setItem(APP_OPEN_DAY_STORAGE_KEY, today);
      } catch {
        // Same as above; the server still counted it.
      }
      if (result.data.changed) router.refresh();
    }

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname, router]);

  return null;
}
