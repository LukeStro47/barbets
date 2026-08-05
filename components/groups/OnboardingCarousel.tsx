'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

const SEEN_KEY = 'barbets-groups-onboarding-seen';

interface Slide {
  icon: string;
  title: string;
  body: string;
  cta?: string;
}

const SLIDES: Slide[] = [
  {
    icon: '🅱️',
    title: 'Prediction markets for your friend group',
    body: 'No real money, ever. Bet tokens on anything, and settle up together.',
  },
  {
    icon: '🙈',
    title: 'Bets are sealed',
    body: "While a market's open, nobody sees who bet what, not even you. The moment it closes, odds appear as a split.",
  },
  {
    icon: '💰',
    title: 'No bookmaker',
    body: "The losing side's stake splits among the winners, proportional to how much each staked. Your own stake comes back too.",
  },
  {
    icon: '👤',
    title: 'Markets can be about a friend',
    body: "@Mention someone, and they won't see it exists, anywhere, until it resolves. Then they see everything.",
  },
  {
    icon: '⚖️',
    title: 'The group decides',
    body: 'Someone says what happened. Nobody disagrees, it stands. Someone challenges it, the group votes by secret ballot.',
  },
  {
    icon: '👀',
    title: 'See it for yourself',
    body: 'Try a demo market next, no signup needed, real math, fake friends.',
    cta: 'Try the demo',
  },
];

/**
 * Full-screen, swipe-through, non-interactive explainer shown the first time
 * a brand-new member lands on the empty /groups hub — before pointing them
 * at the interactive /demo market. Portal-rendered to escape AppHeader's
 * z-10 stacking context (a true takeover, not just an in-page block), one
 * shot only via a permanent localStorage flag, same convention InstallBanner
 * (components/pwa/InstallBanner.tsx) already uses for its own dismissal.
 *
 * Swiping is real CSS scroll-snap, not a hand-rolled drag gesture — the
 * browser handles touch/momentum/rubber-banding, a scroll listener just
 * derives the current slide index to drive the dots.
 */
export function OnboardingCarousel() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setDismissed(localStorage.getItem(SEEN_KEY) === '1');
  }, []);

  useEffect(() => {
    if (dismissed) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [dismissed]);

  if (!mounted || dismissed) return null;

  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: clamped * track.clientWidth, behavior: 'smooth' });
  }

  function syncFromScroll() {
    const track = trackRef.current;
    if (!track) return;
    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }

  function finish(navigateToDemo: boolean) {
    localStorage.setItem(SEEN_KEY, '1');
    setDismissed(true);
    if (navigateToDemo) router.push('/demo');
  }

  const isLast = index === SLIDES.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-paper">
      <button
        type="button"
        onClick={() => finish(false)}
        className="absolute right-4 z-10 rounded-full px-3 py-1.5 text-sm font-semibold text-espresso-400 hover:text-espresso-700"
        style={{ top: 'calc(env(safe-area-inset-top) + 14px)' }}
      >
        Skip
      </button>

      <div
        ref={trackRef}
        onScroll={() => window.requestAnimationFrame(syncFromScroll)}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        style={{ scrollbarWidth: 'none' }}
      >
        {SLIDES.map((slide, i) => (
          <div
            key={slide.title}
            className="flex w-full shrink-0 snap-start flex-col items-center justify-center gap-4 px-8 text-center"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-honey-100 text-4xl">
              {slide.icon}
            </span>
            <h2 className="font-display text-xl font-bold tracking-tight text-espresso-900 text-balance">
              {slide.title}
            </h2>
            <p className="max-w-[26ch] text-espresso-500">{slide.body}</p>
            {slide.cta && (
              <button
                type="button"
                onClick={() => finish(true)}
                className="mt-2 rounded-full bg-honey-500 px-6 py-3 text-base font-bold text-espresso-950 transition-colors hover:bg-honey-600"
              >
                {slide.cta}
              </button>
            )}
          </div>
        ))}
      </div>

      <div
        className="flex flex-col items-center gap-3 pb-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
      >
        <div className="flex gap-1.5">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-4 bg-honey-500' : 'w-1.5 bg-espresso-200')}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => (isLast ? finish(true) : goTo(index + 1))}
          className="rounded-full bg-espresso-900 px-6 py-2.5 text-sm font-bold text-paper-white"
        >
          {isLast ? 'Done' : 'Next'}
        </button>
      </div>
    </div>,
    document.body
  );
}
