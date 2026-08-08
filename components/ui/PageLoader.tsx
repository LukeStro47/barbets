'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoadingAnimation } from '@/components/ui/LoadingAnimation';

const VISIBLE_DELAY_MS = 150;

/** Full-bleed loading state for route `loading.tsx` files. Stays invisible for
    the first 150ms so an already-fast navigation never flashes it in and
    right back out — only renders once the delay has actually elapsed. */
export function PageLoader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), VISIBLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  // Portal to document.body rather than rendering in place, same reasoning Modal.tsx already
  // documents: this mounts wherever the route's loading.tsx boundary sits, which is inside
  // PageTransition's slide-in wrapper — and a CSS transform on any ancestor (PageTransition's
  // `animate-page-in-from-*` classes) becomes the containing block for a `position: fixed`
  // descendant instead of the real viewport. That's what made the loading screen slide/scale
  // along with the incoming page instead of sitting still — a portal sidesteps the whole
  // ancestor chain, landing this as a true sibling of the transformed wrapper, not a child of it.
  return createPortal(
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#EDE9E0]">
      <LoadingAnimation />
    </div>,
    document.body
  );
}
