'use client';

import { useRouter } from 'next/navigation';

/**
 * Real browser-back, not a hardcoded destination — this page is reachable
 * from both the logged-out landing page and from deep inside a group, and a
 * fixed href would send people "home" instead of back to whichever one they
 * actually came from.
 */
export function BackButton({ fallbackHref = '/' }: { fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="text-sm font-semibold text-espresso-500 hover:text-espresso-800"
    >
      ← Back
    </button>
  );
}
