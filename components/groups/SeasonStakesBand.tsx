import Link from 'next/link';
import { ChevronRightIcon } from '@/components/ui/icons';

/**
 * group_settings.prize_text / punishment_text, on the Leaderboard — the one screen that already
 * ranks first and last, so the stakes have somewhere to attach to. Two columns, prize honey-tinted
 * (the thing worth winning), punishment kept neutral rather than danger-toned: danger in this app
 * means "something needs you now" (see lib/marketStatus.ts), and a punishment is neither urgent
 * nor an error.
 *
 * Static text for a member, no tap target. For an owner, the whole band links to the stakes
 * editor instead of carrying a separate "Edit" affordance — including a dedicated empty-state
 * row when neither is set, which a member never sees at all.
 */
export function SeasonStakesBand({
  groupId,
  prizeText,
  punishmentText,
  canEdit,
}: {
  groupId: string;
  prizeText: string | null;
  punishmentText: string | null;
  canEdit: boolean;
}) {
  if (!prizeText && !punishmentText && !canEdit) return null;

  const editHref = `/groups/${groupId}/settings/stakes`;
  const hoverClasses = canEdit ? 'transition-colors hover:bg-rule/60' : '';

  if (!prizeText && !punishmentText) {
    return (
      <Link
        href={editHref}
        className={`flex items-center gap-3 rounded-[16px] border border-hairline bg-surface px-3.5 py-3 ${hoverClasses}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold tracking-[0.09em] text-faint uppercase">Prize / Punishment</span>
          <span className="mt-1 block text-[12.5px] leading-[1.35] font-semibold text-ink">
            Add a prize and a punishment in Settings
          </span>
        </span>
        <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-faint" />
      </Link>
    );
  }

  const columns = (
    <>
      {prizeText && (
        <div className={`w-full flex-1 rounded-[16px] border border-signal bg-signal-tint px-3.5 py-3 ${hoverClasses}`}>
          <p className="text-[10px] font-extrabold tracking-[0.09em] text-signal-deep uppercase">First place</p>
          <p className="mt-1 text-[12.5px] leading-[1.35] font-semibold text-ink">{prizeText}</p>
        </div>
      )}
      {punishmentText && (
        <div className={`w-full flex-1 rounded-[16px] border border-hairline bg-surface px-3.5 py-3 ${hoverClasses}`}>
          <p className="text-[10px] font-extrabold tracking-[0.09em] text-faint uppercase">Last place</p>
          <p className="mt-1 text-[12.5px] leading-[1.35] font-semibold text-ink">{punishmentText}</p>
        </div>
      )}
    </>
  );

  if (canEdit) {
    return (
      <Link href={editHref} className="flex flex-col gap-2.5 min-[341px]:flex-row">
        {columns}
      </Link>
    );
  }

  return <div className="flex flex-col gap-2.5 min-[341px]:flex-row">{columns}</div>;
}
