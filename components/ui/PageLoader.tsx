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
    <div className="flex min-h-dvh items-center justify-center bg-[#EDE9E0]">
      <LoadingAnimation />
    </div>
  );
}
