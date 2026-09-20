import Link from 'next/link';
import { Mention } from '@/components/ui/Mention';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { CheckCircleIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/formatNumber';

export interface SnapshotHighlight {
  user_id: string;
  nickname: string;
  market_id: string;
  market_title: string | null;
}

export interface TitleChange {
  titleKey: string;
  label: string;
  toNickname: string;
  fromNickname: string | null;
}

/** Biggest win / biggest upset / titles-changed-hands — everything here reads straight off
 * season_results.snapshot (see the finalize-season migration) except titleChanges, which the
 * caller derives by diffing this season's titles_snapshot against the previous season_results
 * row's (see app/(app)/groups/[groupId]/page.tsx). Any row with nothing to show is simply
 * omitted rather than rendering an empty state — a first-ever season has no titleChanges to
 * diff against, and that's expected, not an error. */
export function SeasonHighlightsCard({
  groupId,
  biggestSingleWin,
  biggestUpset,
  titleChanges,
}: {
  groupId: string;
  biggestSingleWin: (SnapshotHighlight & { amount: number }) | null;
  biggestUpset: (SnapshotHighlight & { multiple: number }) | null;
  titleChanges: TitleChange[];
}) {
  if (!biggestSingleWin && !biggestUpset && titleChanges.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-xs font-bold tracking-[0.08em] text-faint uppercase">Highlights</h2>
      <div className="overflow-hidden rounded-[22px] border border-hairline bg-surface">
        {biggestSingleWin && (
          <Link
            href={`/groups/${groupId}/markets/${biggestSingleWin.market_id}/reveal`}
            className="flex items-center gap-3 border-b border-rule px-4 py-[14px] transition-colors hover:bg-rule/25 last:border-b-0"
          >
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-signal-tint">
              <CheckCircleIcon className="h-5 w-5 text-signal" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-ink">Biggest single win</span>
              <span className="block truncate text-[11.5px] leading-[1.35] text-faint">
                <Mention nickname={biggestSingleWin.nickname} /> on &quot;{biggestSingleWin.market_title ?? 'a settled market'}&quot;
              </span>
            </span>
            <span className="shrink-0 text-[13.5px] font-extrabold text-gain">+{formatTokens(biggestSingleWin.amount)}</span>
          </Link>
        )}
        {biggestUpset && (
          <Link
            href={`/groups/${groupId}/markets/${biggestUpset.market_id}/reveal`}
            className="flex items-center gap-3 border-b border-rule px-4 py-[14px] transition-colors hover:bg-rule/25 last:border-b-0"
          >
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-signal-tint">
              <AwardGlyph iconKey="spike" stroke="var(--color-signal)" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-ink">Biggest upset</span>
              <span className="block truncate text-[11.5px] leading-[1.35] text-faint">
                &quot;{biggestUpset.market_title ?? 'a settled market'}&quot;, <Mention nickname={biggestUpset.nickname} />
              </span>
            </span>
            <span className="shrink-0 text-[13.5px] font-extrabold text-signal">{biggestUpset.multiple}x</span>
          </Link>
        )}
        {titleChanges.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-[14px]">
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-signal-tint">
              <AwardGlyph iconKey="target" stroke="var(--color-signal)" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-ink">Titles changed hands</span>
              <span className="block text-[11.5px] leading-[1.35] text-faint">
                {titleChanges.map((t, i) => (
                  <span key={t.titleKey}>
                    {i > 0 && ', '}
                    {t.label} to <Mention nickname={t.toNickname} />
                  </span>
                ))}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
