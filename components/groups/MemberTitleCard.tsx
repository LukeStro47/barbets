import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { TITLE_META, type TitleKey } from '@/lib/titles';

/** Member-only "you took a title" callout — omitted entirely when the viewer holds none.
 * Leads with the first title in TITLE_ORDER the viewer holds (the hero's "N titles held" stat
 * already carries the count, so this card doesn't need to enumerate all of them). `label`/
 * `iconKey` are the resolved (owner-overridden or default) name/icon; `format` still comes from
 * TITLE_META[titleKey] since the underlying dynamic isn't customizable, only its name/icon are. */
export function MemberTitleCard({
  titleKey,
  label,
  iconKey,
  statValue,
  otherCount,
}: {
  titleKey: TitleKey;
  label: string;
  iconKey: string;
  statValue: number | null;
  otherCount: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] border border-honey-200 bg-honey-50 p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-honey-300 bg-paper-white">
        <AwardGlyph iconKey={iconKey} stroke="var(--color-honey-700)" size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-extrabold tracking-[0.1em] text-honey-700 uppercase">You took a title</span>
        <span className="mt-0.5 block text-[15px] font-extrabold text-espresso-950">{label}</span>
        <span className="block text-[11.5px] text-espresso-500">
          {TITLE_META[titleKey].format(statValue)}
          {otherCount > 0 && ` · plus ${otherCount} more`}
        </span>
      </span>
    </div>
  );
}
