'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { RefreshIcon } from '@/components/ui/icons';
import { shouldDisablePullToRefresh } from '@/lib/navRoute';

const TRIGGER_PX = 72;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.5;
const SPINNER_PX = 36;
// A refresh that comes back almost instantly would otherwise flash the spinner for a frame or
// not at all, which reads as the pull having done nothing.
const MIN_SPIN_MS = 600;

/**
 * Pull-down-to-refresh for every page under the authed app shell. Plain touch
 * events (no native plugin) so the exact same code works in the browser/PWA
 * and inside the Capacitor WebView. Only arms once the page is scrolled to
 * the very top, so it can't hijack a normal scroll gesture, and bails out
 * while a modal/sheet has body scroll locked (BetslipBar's existing
 * `document.body.style.overflow = 'hidden'` signal) so a stray drag on an
 * open sheet can't also trigger a refresh underneath it.
 *
 * It also doesn't arm at all on the draft-holding routes
 * (`shouldDisablePullToRefresh`). For the two create wizards that's because
 * "scrolled to the very top" is the whole arming condition and those screens
 * are sized to fit the viewport, so they're at scrollY 0 for their entire
 * life — a downward drag anywhere on the form would pull the refresh
 * indicator instead of doing nothing. For all of them, including the group
 * settings editor, refreshing is actively destructive rather than merely
 * useless: the answers live in client state, so a re-fetch throws away
 * everything typed since the page loaded and re-renders the same server data.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const startYRef = useRef<number | null>(null);
  const triggeredAtRef = useRef(0);
  const pullRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (isPending || triggered || shouldDisablePullToRefresh(pathname)) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0) return;
      if (getComputedStyle(document.body).overflow === 'hidden') return;
      startYRef.current = e.touches[0].clientY;
      setDragging(true);
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (window.scrollY > 0) {
        startYRef.current = null;
        setDragging(false);
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Moving up without having scrolled yet (a finger often wobbles a pixel or two upward as it
      // lands) just means no pull for now. Abandoning the gesture here used to make the next
      // downward movement do nothing at all, so the spinner never appeared.
      if (delta <= 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      e.preventDefault();
      const resisted = Math.min(delta * RESISTANCE, MAX_PULL_PX);
      pullRef.current = resisted;
      setPull(resisted);
    }

    function onTouchEnd() {
      if (startYRef.current === null) return;
      startYRef.current = null;
      setDragging(false);
      if (pullRef.current >= TRIGGER_PX) {
        setTriggered(true);
        triggeredAtRef.current = Date.now();
        startTransition(() => {
          router.refresh();
        });
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [isPending, triggered, router, pathname]);

  useEffect(() => {
    if (!triggered || isPending) return;
    const timer = setTimeout(() => {
      setTriggered(false);
      pullRef.current = 0;
      setPull(0);
    }, Math.max(0, MIN_SPIN_MS - (Date.now() - triggeredAtRef.current)));
    return () => clearTimeout(timer);
  }, [triggered, isPending]);

  const travel = triggered ? TRIGGER_PX : pull;
  const spinning = triggered;
  const spinDeg = reducedMotionRef.current ? 0 : (pull / TRIGGER_PX) * 360;

  return (
    <>
      {/* The disc slides down over the page; the page itself doesn't move. It used to: the whole
          page was translated down to open a gap for the spinner, but every page's sticky header
          extends up behind the status bar (-mt/pt of env(safe-area-inset-top)), so the header's
          own white top padding slid down with it and left grey and white bands across the top,
          with the gap that was left mostly under the status bar and too thin to show the spinner
          clearly. Always mounted, so it rides back up on release instead of vanishing mid-slide. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-50 -ml-[18px] flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted shadow-[0_2px_8px_rgba(12,16,24,0.2)]"
        style={{
          transform: `translateY(${travel - SPINNER_PX + 8}px)`,
          opacity: Math.min(1, travel / (TRIGGER_PX / 2)),
          transition: dragging || reducedMotionRef.current ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
        }}
      >
        <div style={{ transform: spinning ? undefined : `rotate(${spinDeg}deg)` }}>
          <RefreshIcon className={`block h-5 w-5 ${spinning ? 'animate-spin' : ''}`} />
        </div>
      </div>
      {children}
    </>
  );
}
