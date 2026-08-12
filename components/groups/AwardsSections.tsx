'use client';

import { useState } from 'react';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { ChevronRightIcon } from '@/components/ui/icons';
import { TITLE_META, type TitleKey } from '@/lib/titles';
import { numberWordCapitalized } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

/** The titles the viewer holds, as a shelf you swipe rather than a stack of full-width hero cards.
 * Holding three used to mean three dark blocks pushing everyone else's titles below the fold; on a
 * rail they read as a collection, which is what holding several of them actually is. */
export function AwardsRail({ titles }: { titles: { key: TitleKey; stat: string }[] }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div
        onScroll={(e) => {
          // 196px card + 10px gap. Rounding rather than flooring so the dot flips at the halfway
          // point of a drag, which is where the eye has already committed to the next card.
          const index = Math.round(e.currentTarget.scrollLeft / 206);
          if (index !== active) setActive(Math.min(Math.max(index, 0), titles.length - 1));
        }}
        className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 [scroll-snap-type:x_mandatory] [scrollbar-width:none]"
      >
        {titles.map((t) => (
          <div
            key={t.key}
            className="relative w-[196px] shrink-0 overflow-hidden rounded-[20px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-4 [scroll-snap-align:start]"
          >
            <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_85%_6%,rgba(232,163,61,0.34),rgba(232,163,61,0)_60%)]" />
            <div className="relative">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-honey-300/45 bg-honey-500/16">
                <AwardGlyph titleKey={t.key} stroke="var(--color-honey-300)" size={22} />
              </span>
              <p className="mt-3 text-[10px] font-extrabold tracking-[0.1em] text-honey-300 uppercase">Yours</p>
              <p className="mt-[3px] text-[17px] font-extrabold tracking-[-0.01em] text-paper-white">{TITLE_META[t.key].label}</p>
              <p className="mt-1 text-xs text-paper-white/60">{t.stat}</p>
            </div>
          </div>
        ))}
        <span className="w-1 shrink-0" />
      </div>

      {titles.length > 1 && (
        <div className="mt-2.5 flex justify-center gap-[5px]">
          {titles.map((t, i) => (
            <span
              key={t.key}
              className={cn('h-1 rounded-full transition-all', i === active ? 'w-4 bg-honey-600' : 'w-1 bg-espresso-200')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Titles nobody holds, behind one row. They're the least interesting thing on the page until the
 * moment you go looking for something to chase, so they cost one tap rather than a screen of
 * dashed placeholders. */
export function UnclaimedTitles({ keys }: { keys: TitleKey[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl border-0 bg-paper-dim px-[15px] py-[13px] text-left"
      >
        <span className="text-[12.5px] font-extrabold text-espresso-700">
          {numberWordCapitalized(keys.length)} {keys.length === 1 ? 'title' : 'titles'} unclaimed
        </span>
        <ChevronRightIcon className={cn('h-3 w-[7px] text-espresso-400 transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {keys.map((key) => (
            <div key={key} className="flex items-center gap-[11px] rounded-2xl border border-dashed border-espresso-200 px-3.5 py-3">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-dashed border-espresso-200">
                <AwardGlyph titleKey={key} stroke="var(--color-espresso-300)" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-extrabold text-espresso-600">{TITLE_META[key].label}</span>
                <span className="block text-[11px] leading-[1.4] text-espresso-400">{TITLE_META[key].description}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
