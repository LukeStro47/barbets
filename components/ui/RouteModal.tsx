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
 */
export function RouteModal({ children }: { children: React.ReactNode }) {
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
        className="relative max-h-full w-full max-w-lg overflow-y-auto rounded-[22px] bg-paper-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-espresso-50 text-espresso-500 transition-colors hover:bg-espresso-100"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        <div className="space-y-5 p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
