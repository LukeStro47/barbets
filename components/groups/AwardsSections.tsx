'use client';

import { useState } from 'react';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { EditTitleButton } from '@/components/groups/EditTitleButton';
import { ChevronRightIcon } from '@/components/ui/icons';
import { SwipeRail } from '@/components/ui/SwipeRail';
import { type TitleKey } from '@/lib/titles';
import { numberWordCapitalized } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

export interface ResolvedTitle {
  key: TitleKey;
  label: string;
  description: string;
  iconKey: string;
}

/** The titles the viewer holds, as a shelf you swipe rather than a stack of full-width hero cards.
 * Holding three used to mean three dark blocks pushing everyone else's titles below the fold; on a
 * rail they read as a collection, which is what holding several of them actually is.
 *
 * The icon sits top-right rather than top-left: the title/stat/description is the actual content
 * and reads left-to-right from the card's leading edge, with the glyph as a corner mark rather
 * than something the eye has to step around first. The description (never shown on this card
 * before) fills what used to be a lot of bare gradient underneath the stat line. */
export function AwardsRail({ groupId, isOwner, titles }: { groupId: string; isOwner: boolean; titles: (ResolvedTitle & { stat: string })[] }) {
  return (
    <SwipeRail>
      {titles.map((t) => (
        <div
          key={t.key}
          className="relative w-full shrink-0 overflow-hidden rounded-[22px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-5 [scroll-snap-align:start]"
        >
          <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_85%_6%,rgba(232,163,61,0.34),rgba(232,163,61,0)_60%)]" />
          <div className="relative flex items-start justify-between gap-3">
            <p className="text-[10px] font-extrabold tracking-[0.1em] text-honey-300 uppercase">Yours</p>
            <span className="flex shrink-0 items-center gap-1">
              {isOwner && (
                <EditTitleButton groupId={groupId} titleKey={t.key} currentLabel={t.label} currentIconKey={t.iconKey} defaultLabel={t.label} dark />
              )}
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-honey-300/45 bg-honey-500/16">
                <AwardGlyph iconKey={t.iconKey} stroke="var(--color-honey-300)" size={22} />
              </span>
            </span>
          </div>
          <p className="relative mt-2.5 text-[19px] leading-[1.15] font-extrabold tracking-[-0.01em] text-balance text-paper-white">{t.label}</p>
          <p className="relative mt-1 text-[12.5px] leading-[1.35] font-bold text-honey-300">{t.stat}</p>
          <p className="relative mt-3 border-t border-white/10 pt-3 text-[12.5px] leading-[1.45] text-paper-white/60">{t.description}</p>
        </div>
      ))}
    </SwipeRail>
  );
}

/** Titles nobody holds, behind one row. They're the least interesting thing on the page until the
 * moment you go looking for something to chase, so they cost one tap rather than a screen of
 * dashed placeholders. */
export function UnclaimedTitles({ groupId, isOwner, titles }: { groupId: string; isOwner: boolean; titles: ResolvedTitle[] }) {
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
          {numberWordCapitalized(titles.length)} {titles.length === 1 ? 'title' : 'titles'} unclaimed
        </span>
        <ChevronRightIcon className={cn('h-3 w-[7px] text-espresso-400 transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {titles.map((t) => (
            <div key={t.key} className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-[11px] rounded-2xl border border-dashed border-espresso-200 px-3.5 py-3">
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-dashed border-espresso-200">
                  <AwardGlyph iconKey={t.iconKey} stroke="var(--color-espresso-300)" size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-extrabold text-espresso-600">{t.label}</span>
                  <span className="block text-[11px] leading-[1.4] text-espresso-400">{t.description}</span>
                </span>
              </div>
              {isOwner && (
                <EditTitleButton groupId={groupId} titleKey={t.key} currentLabel={t.label} currentIconKey={t.iconKey} defaultLabel={t.label} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
