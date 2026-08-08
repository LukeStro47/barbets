'use client';

import { usePathname } from 'next/navigation';
import { shouldHideBottomNav } from '@/lib/navRoute';

/** Reserves scroll room at the bottom of every page so content doesn't sit under the fixed
 * BottomNav — a plain padding div, not position:fixed itself, so (unlike BottomNav) it's safe
 * to nest inside PullToRefresh/PageTransition's transformed wrappers. */
export function BottomNavSpacer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (shouldHideBottomNav(pathname)) return <>{children}</>;
  return <div className="pb-24">{children}</div>;
}
