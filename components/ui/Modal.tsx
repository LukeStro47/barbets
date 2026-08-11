'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/** Ported to document.body rather than rendered in place: a modal needs `position: fixed`
 * to stay glued to the real viewport regardless of scroll, but any ancestor with so much as
 * a computed `transform` (even an inert identity one, like a completed CSS animation left
 * behind by its fill mode) turns into that fixed element's containing block instead of the
 * viewport, silently un-centering it. A portal sidesteps the whole ancestor chain for good. */
export function Modal({
  onClose,
  children,
  padded = true,
  panelClassName,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** Off for the modals that own their own header/footer bands edge to edge (the bonus pool
   * explainer, "call the result", "review your market") — they need the panel to be a bare
   * rounded box, not a padded stack. Everything else keeps the default spacing. */
  padded?: boolean;
  panelClassName?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso-950/40 px-5"
      onClick={onClose}
    >
      <div
        // The radius rides with `padded` rather than sitting in the base: the banded modals all
        // want rounded-[22px], and `cn` is a plain join with no conflict resolution, so leaving a
        // rounded-2xl in the base would make which one wins depend on stylesheet order.
        className={cn(
          'w-full max-w-sm bg-paper-white shadow-xl',
          padded ? 'space-y-3 rounded-2xl p-5' : 'rounded-[22px]',
          panelClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
