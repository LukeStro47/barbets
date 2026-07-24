'use client';

import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// Any real back/forward navigation (browser back gesture, NativeBackButton's
// window.history.back(), a real edge swipe) fires a native popstate event —
// a <Link> click or router.push() never does. Module-level rather than state
// so it survives being read from outside React's render cycle, and gets
// consumed (reset) the moment a route change actually uses it.
let lastNavWasPop = false;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastNavWasPop = true;
  });
}

/**
 * Wraps route content so navigating to a new route slides the incoming page in
 * from the direction it conceptually came from (left for back, right for
 * forward) instead of an abrupt swap — there's no native cross-platform way to
 * get this inside a Capacitor WebView, so it's faked with a one-sided CSS
 * entrance animation on whichever content just mounted. Skipped entirely under
 * prefers-reduced-motion, and on the very first paint (no prior route to have
 * "come from").
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  const [transitionClass, setTransitionClass] = useState<string | null>(null);

  if (pathname !== prevPathnameRef.current) {
    prevPathnameRef.current = pathname;
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nextClass = reducedMotion ? null : lastNavWasPop ? 'animate-page-in-from-left' : 'animate-page-in-from-right';
    lastNavWasPop = false;
    if (nextClass !== transitionClass) setTransitionClass(nextClass);
  }

  return (
    <div key={pathname} className={transitionClass ?? undefined}>
      {children}
    </div>
  );
}
