'use client';

import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isMemberProfileModalRoute } from '@/lib/navRoute';

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
 *
 * Opening or closing the intercepted member-profile modal changes `usePathname()`
 * without changing what this slot renders at all — the page underneath (leaderboard, a
 * member's own record, an award's "held by" list, ...) keeps rendering exactly as it was
 * while the modal floats on top in the separate `@modal` slot. Keying this div on the raw
 * pathname used to remount (and slide-transition) that unchanged content every time the
 * modal opened or closed, which read as the whole page jumping for no reason — see
 * isMemberProfileModalRoute.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  const animKeyRef = useRef(pathname);
  const [transitionClass, setTransitionClass] = useState<string | null>(null);

  if (pathname !== prevPathnameRef.current) {
    const wasModal = isMemberProfileModalRoute(prevPathnameRef.current);
    const isModal = isMemberProfileModalRoute(pathname);
    prevPathnameRef.current = pathname;

    if (!wasModal && !isModal) {
      animKeyRef.current = pathname;
      const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const nextClass = reducedMotion ? null : lastNavWasPop ? 'animate-page-in-from-left' : 'animate-page-in-from-right';
      if (nextClass !== transitionClass) setTransitionClass(nextClass);
    }
    // Consumed either way: a modal-closing router.back() is a real popstate too, and leaving
    // this set would wrongly mark the *next* genuine navigation as "from a pop".
    lastNavWasPop = false;
  }

  return (
    // The animation's "both" fill mode holds its final `transform:
    // translateX(0)` on this div forever once it finishes — and any
    // computed transform, even a no-op one, makes this div the containing
    // block for every position:fixed descendant instead of the real
    // viewport (this broke BetslipBar's fixed bottom sheet on iOS PWA).
    // Clearing the class once the animation ends drops the transform and
    // restores normal fixed-positioning for the rest of the visit.
    <div key={animKeyRef.current} className={transitionClass ?? undefined} onAnimationEnd={() => setTransitionClass(null)}>
      {children}
    </div>
  );
}
