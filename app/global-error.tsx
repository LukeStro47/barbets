'use client';

import { useEffect } from 'react';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { reportClientError } from '@/lib/actions/errorReport';

// Imported again rather than shared with the root layout: this file replaces that layout
// outright, so anything it set up (the stylesheet, the display font's CSS variable) is simply
// not there. A crash page that renders unstyled reads as a second, worse failure.
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage' });

/**
 * The last-resort boundary: a render that throws anywhere the app doesn't
 * otherwise catch. It replaces the root layout entirely (hence its own <html>
 * and <body>), so it can't use anything that depends on layout context, and it
 * is styled to match not-found.tsx rather than inventing a second voice for
 * "something went wrong."
 *
 * It also reports. `instrumentation.ts` never sees a client-side render crash,
 * which in an installed PWA is most of what a user experiences as the app
 * breaking.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // A digest means this error came from the server and was already reported
    // by onRequestError, with a real un-minified stack attached. Reporting it
    // again from here would only add a second, worse copy of the same bug.
    if (error.digest) return;
    void reportClientError({
      name: error.name,
      message: error.message,
      stack: error.stack,
      url: typeof window === 'undefined' ? undefined : window.location.pathname + window.location.search,
    });
  }, [error]);

  return (
    <html lang="en" className={bricolage.variable}>
      <body className="font-sans antialiased">
        <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-7 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
          {/* Texture, not a heading — same treatment as the 404's numerals. */}
          <span aria-hidden className="font-display text-[120px]/none font-extrabold tracking-[-0.05em] text-espresso-100">
            !
          </span>
          <h1 className="mt-6 font-display text-[30px]/[34px] font-extrabold tracking-[-0.03em] text-espresso-900">
            Something went wrong on our end.
          </h1>
          <p className="mt-3 max-w-[300px] text-base/6 text-espresso-500">
            Nothing you did caused this, and no bets or balances are affected. We've been told about it.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-9 w-full max-w-[330px] rounded-full bg-honey-500 px-6 py-4 text-[17px] font-bold whitespace-nowrap text-espresso-900 transition-colors hover:bg-honey-600"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
