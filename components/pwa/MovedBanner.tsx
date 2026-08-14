'use client';

import { useEffect, useState } from 'react';
import { APP_ORIGIN } from '@/lib/appOrigin';

/**
 * A temporary banner shown only to people using the app on mybarbets.com, telling them it is
 * moving to app.mybarbets.com. Delete this component (and its mount in app/layout.tsx) once the
 * old domain has been the landing site for a while.
 *
 * Why a hostname check is the right targeting: an installed PWA is bound to the origin it was
 * installed from, and there is no way to move one. So the people who need this message are exactly
 * the people whose browser is currently on mybarbets.com, and this code only runs when the page
 * was served from there. No server work, no schema change, no way to mis-target. Push
 * subscriptions record no origin, so a notification cannot be aimed this precisely.
 *
 * The native app is unaffected: its WebView loads capacitor.config.ts's server.url, which is not
 * this hostname, so the check fails there and the banner never renders.
 */

const DISMISS_KEY = 'bb-moved-banner-dismissed';
const DISMISS_DAYS = 3;

/**
 * An exact-match list rather than an endsWith check, so app.mybarbets.com (the destination) can
 * never match the thing telling people to leave.
 */
function shouldShowForHost(hostname: string): boolean {
  return hostname === 'mybarbets.com' || hostname === 'www.mybarbets.com';
}

export function MovedBanner() {
  // Rendered from an effect rather than server-side: the hostname is only knowable in the browser,
  // and reading the Host header in the root layout would opt the entire app out of static
  // rendering for the sake of a banner most people never see.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!shouldShowForHost(window.location.hostname)) return;
    try {
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY));
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 86_400_000) return;
    } catch {
      // Private mode or blocked storage: show the banner rather than swallowing the message.
    }
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="border-b border-honey-300 bg-honey-100 pt-[env(safe-area-inset-top)] text-espresso-900">
      <div className="mx-auto flex max-w-lg items-start gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14px] font-extrabold tracking-[-0.01em]">Barbets has moved</p>
          {/* Present tense, no date. The domain flip is imminent rather than scheduled, and a
              banner promising a future cutoff would be a promise this code cannot keep: once the
              domain moves, this component stops rendering entirely (the app no longer serves that
              host), so it can never come back to correct itself. */}
          <p className="mt-0.5 text-[13px]/[19px] text-espresso-700">
            This address is being retired. Open Barbets at its new home and add it to your home
            screen again, then delete the old icon. Your groups and balances come with you.
          </p>
          <a
            href={APP_ORIGIN}
            className="mt-2 inline-block rounded-full bg-espresso-800 px-3.5 py-1.5 text-[13px] font-bold text-paper-white"
          >
            Go to app.mybarbets.com
          </a>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {
              // Nothing to do; the banner just returns on the next load.
            }
            setShow(false);
          }}
          className="-mr-1 shrink-0 rounded-full px-2 py-1 text-[15px] font-bold text-espresso-500"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
