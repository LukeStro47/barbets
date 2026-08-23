'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { CloseIcon } from '@/components/ui/icons';

/**
 * The centered-dialog shell for an intercepted route (see the `@modal` slot in `app/(app)/`) —
 * distinct from `components/ui/Modal`, which is opened/closed by a client component's own local
 * state and stays small (`max-w-sm`) for a confirmation or a short form. This one is opened by
 * *navigating* to a route Next.js intercepts, closed by `router.back()` rather than a state
 * setter (so the browser back button and this dialog's own close button do the same thing), and
 * sized for a page's worth of content (`max-w-lg`, its own internal scroll) rather than a sheet.
 *
 * `router.back()` relies on there being a real "before" entry — every place that opens one of
 * these is a same-app link tap, never a page someone can land on directly (that's what the
 * intercepted route's real, non-modal sibling page is for), so there's always a page underneath.
 *
 * The header band is the same `bg-espresso-50` strip every other banded modal in the app uses
 * (see `Modal`'s `padded={false}` callers) — the close control lives inside that row rather than
 * floating over the content's own top-right corner, which used to collide with whatever the
 * content put there (an avatar, a badge link) and never lined up with the same close affordance
 * used everywhere else.
 */
export function RouteModal({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') router.back();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [router]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso-950/40 px-5 py-8" onClick={() => router.back()}>
      <div
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-[22px] bg-paper-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[13px]">
          <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">{title}</p>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-espresso-500 transition-colors hover:bg-espresso-100"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
