'use client';

import { useEffect, useState } from 'react';

/**
 * This page is reached two different ways: `navigator.onLine === false` (the device really has no
 * connection, the original and most common case) and `navigator.onLine === true` (the device has a
 * connection but the request still failed, e.g. Supabase itself degraded - see the 2026-08-29
 * incident in ARCHITECTURE.md's PWA & push notes). Telling a user with a live connection "you're
 * offline" reads as wrong and unhelpful when the actual problem is on our end. Defaults to the
 * offline copy (the historically common case, and the safer read if `navigator.onLine` is
 * unavailable) until the effect confirms otherwise, same reasoning OfflineGroupBalances gives for
 * reading client state on mount instead of assuming a fresh render.
 */
export function OfflineHeadline() {
  const [isOffline, setIsOffline] = useState(true);

  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <>
      <h1 className="mt-7 font-display text-[30px]/[34px] font-extrabold tracking-[-0.03em] text-espresso-900">
        {isOffline ? "You're offline." : "We're having trouble."}
      </h1>
      <p className="mt-3 max-w-[310px] text-base/6 text-espresso-500">
        {isOffline
          ? "Odds and balances move too fast to show you a guess. Reconnect and we'll pick up where you left off."
          : "Your connection looks fine, so this is on us. Hang tight and try again in a minute."}
      </p>
    </>
  );
}
