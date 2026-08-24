import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { Mention } from '@/components/ui/Mention';
import { TITLE_META, type TitleKey } from '@/lib/titles';

/** A title the viewer held at the start of the season that just closed, but no longer holds —
 * from lib/seasonTitleDiff's diffTitleSnapshots, filtered to changes where the viewer was the
 * "from" holder. Dashed outline (vs. AwardsRail's solid dark "yours" treatment) reads as the
 * negative space of that same card. */
export function LostTitleCard({ titleKey, toNickname }: { titleKey: TitleKey; toNickname: string }) {
  const meta = TITLE_META[titleKey];
  return (
    <div className="rounded-[20px] border border-dashed border-espresso-200 p-3.5">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-espresso-200">
        <AwardGlyph titleKey={titleKey} stroke="var(--color-espresso-400)" size={22} />
      </span>
      <p className="mt-3 text-[10px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">Lost this season</p>
      <p className="mt-0.5 text-[15.5px] leading-[1.15] font-extrabold tracking-[-0.01em] text-espresso-700">{meta.label}</p>
      <p className="mt-1 text-[11.5px] leading-[1.35] text-espresso-400">
        <Mention nickname={toNickname} /> took it
      </p>
    </div>
  );
}
