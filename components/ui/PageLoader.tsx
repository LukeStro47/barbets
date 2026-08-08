'use client';

import { useEffect, useState } from 'react';
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

  return (
    // fixed, not min-h-dvh: this renders inside BottomNavSpacer's padded wrapper (reserves room
    // for BottomNav below it), and an in-flow full-viewport-height block plus that padding
    // overflowed the real viewport height, making an otherwise-static loading screen scrollable.
    // z-20 sits below BottomNav's z-30, same reasoning BootSplash already uses fixed inset-0.
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#EDE9E0]">
      <LoadingAnimation />
    </div>
  );
}
