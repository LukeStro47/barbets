'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Ported to document.body rather than rendered in place: a modal needs `position: fixed`
 * to stay glued to the real viewport regardless of scroll, but any ancestor with so much as
 * a computed `transform` (even an inert identity one, like a completed CSS animation left
 * behind by its fill mode) turns into that fixed element's containing block instead of the
 * viewport, silently un-centering it. A portal sidesteps the whole ancestor chain for good. */
export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso-950/40 px-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl bg-paper-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
