'use client';

import { useRef, useState } from 'react';
import { CaretLeftIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

const GAP = 10; // matches gap-2.5 on the track below

/** A horizontally-swipeable, full-width rail of cards with scroll-snap, dot indicators, and
 * prev/next arrows (only shown once there's more than one card to move between). Used anywhere a
 * "one full card at a time" carousel is needed rather than a peek-two-cards-at-once row, so the
 * swipe/arrow/dot mechanics live in one place instead of being re-derived per section. */
export function SwipeRail({ children }: { children: React.ReactNode[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = children.length;

  function syncFromScroll() {
    const track = trackRef.current;
    if (!track) return;
    const step = (track.firstElementChild as HTMLElement | null)?.clientWidth ?? 0;
    if (step <= 0) return;
    const index = Math.round(track.scrollLeft / (step + GAP));
    setActive(Math.min(Math.max(index, 0), count - 1));
  }

  function goTo(i: number) {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(count - 1, i));
    const step = (track.firstElementChild as HTMLElement | null)?.clientWidth ?? 0;
    if (step <= 0) return;
    track.scrollTo({ left: clamped * (step + GAP), behavior: 'smooth' });
    setActive(clamped);
  }

  return (
    <div>
      <div
        ref={trackRef}
        onScroll={() => window.requestAnimationFrame(syncFromScroll)}
        // scroll-pl-5 matches the px-5: without it, mandatory snapping aligns the first card to
        // the scrollport's border edge and immediately scrolls the padding away, parking every
        // card 20px left of the heading above them.
        className="-mx-5 flex scroll-pl-5 gap-2.5 overflow-x-auto px-5 pb-1 [scroll-snap-type:x_mandatory] [scrollbar-width:none]"
      >
        {children}
        <span className="w-1 shrink-0" />
      </div>

      {count > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label="Previous"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-espresso-100 bg-paper-white text-espresso-600 disabled:opacity-30"
          >
            <CaretLeftIcon className="h-3 w-3" />
          </button>
          <div className="flex gap-[5px]">
            {children.map((_, i) => (
              <span key={i} className={cn('h-1 rounded-full transition-all', i === active ? 'w-4 bg-honey-600' : 'w-1 bg-espresso-200')} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            disabled={active === count - 1}
            aria-label="Next"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-espresso-100 bg-paper-white text-espresso-600 disabled:opacity-30"
          >
            <CaretLeftIcon className="h-3 w-3 rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}
