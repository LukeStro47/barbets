import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { Mention } from '@/components/ui/Mention';

/** A title the viewer held at the start of the season that just closed, but no longer holds —
 * from lib/seasonTitleDiff's diffTitleSnapshots, filtered to changes where the viewer was the
 * "from" holder. Dashed outline (vs. AwardsRail's solid ink "yours" treatment) reads as the
 * negative space of that same card. `label`/`iconKey` are the title's *current* resolved
 * name/icon (owner overrides applied), not a historical snapshot of what it was called then. */
export function LostTitleCard({ label, iconKey, toNickname }: { label: string; iconKey: string; toNickname: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-dash bg-surface p-3.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-dashed border-dash">
        <AwardGlyph iconKey={iconKey} stroke="var(--color-faint)" size={20} />
      </span>
      <p className="mt-3 text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Lost this season</p>
      <p className="mt-0.5 text-[15px] leading-[1.15] font-bold tracking-[-0.01em] text-muted">{label}</p>
      <p className="mt-1 text-[12.5px] leading-[1.35] text-faint">
        <Mention nickname={toNickname} /> took it
      </p>
    </div>
  );
}
