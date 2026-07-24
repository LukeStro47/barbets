'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshIcon } from '@/components/ui/icons';

const TRIGGER_PX = 72;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.5;

/**
 * Pull-down-to-refresh for every page under the authed app shell. Plain touch
 * events (no native plugin) so the exact same code works in the browser/PWA
 * and inside the Capacitor WebView. Only arms once the page is scrolled to
 * the very top, so it can't hijack a normal scroll gesture, and bails out
 * while a modal/sheet has body scroll locked (BetslipBar's existing
 * `document.body.style.overflow = 'hidden'` signal) so a stray drag on an
 * open sheet can't also trigger a refresh underneath it.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (isPending || triggered) return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0) return;
      if (getComputedStyle(document.body).overflow === 'hidden') return;
      startYRef.current = e.touches[0].clientY;
      setDragging(true);
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0 || window.scrollY > 0) {
        startYRef.current = null;
        setDragging(false);
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
  }, [isPending, triggered, router]);

  useEffect(() => {
    if (triggered && !isPending) {
      setTriggered(false);
      pullRef.current = 0;
      setPull(0);
    }
  }, [triggered, isPending]);

  const indicatorHeight = triggered ? TRIGGER_PX : pull;
  const showIndicator = indicatorHeight > 0;
  const spinning = triggered;
  const spinDeg = reducedMotionRef.current ? 0 : (pull / TRIGGER_PX) * 360;

  return (
    <div className="relative">
      {showIndicator && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-[5] flex justify-center overflow-hidden"
          style={{ height: indicatorHeight }}
        >
          <div
            className="mt-2 flex h-7 w-7 items-center justify-center rounded-full bg-paper-white text-espresso-500 shadow-[0_1px_4px_rgba(44,31,23,0.18)]"
            style={{ transform: spinning ? undefined : `rotate(${spinDeg}deg)` }}
          >
            <RefreshIcon className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} />
          </div>
        </div>
      )}
      <div
        style={{
          transform: indicatorHeight > 0 ? `translateY(${indicatorHeight}px)` : undefined,
          transition: dragging || reducedMotionRef.current ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
