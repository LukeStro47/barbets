'use client';

import { useEffect, useState } from 'react';

/**
 * 5p's "persistent bar under the title" — a small ambient notice shown while browsing
 * already-loaded content with no connection, distinct from `/offline`'s full-page fallback
 * (OfflineHeadline), which only ever renders after a *navigation* actually fails. This one
 * covers the more common case: you're sitting on a page that loaded fine, the connection drops,
 * and everything on screen is now stale without saying so. Same online/offline event pattern
 * OfflineHeadline already uses, mounted once in app/(app)/layout.tsx rather than per page.
 */
export function OfflineBar() {
  const [isOffline, setIsOffline] = useState(false);

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

  if (!isOffline) return null;

  return (
    <div className="sticky top-0 z-30 flex items-center justify-center gap-[10px] border-b border-hairline bg-rule px-4 py-[10px]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5a6373" strokeWidth={2} strokeLinecap="round" className="shrink-0">
        <path d="M4 4l16 16" />
        <path d="M5 12.5a10 10 0 0 1 4-2.4M15 10.2a10 10 0 0 1 4 2.3M12 18.5v.01" />
      </svg>
      <span className="text-[12.5px] font-bold text-ink">No connection, showing the last thing we had</span>
    </div>
  );
}
