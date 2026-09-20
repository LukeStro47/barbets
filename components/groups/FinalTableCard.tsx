import Link from 'next/link';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import type { FinalBalanceRow } from '@/components/groups/SeasonRecapHero';

/** The frozen standings from `season_results.snapshot.final_balances`, top rows plus a link to
 * the full table on Leaderboard — hairline rows with mono balances, matching the live
 * standings treatment. */
export function FinalTableCard({
  groupId,
  finalBalances,
  viewerUserId,
  maxRows = 4,
}: {
  groupId: string;
  finalBalances: FinalBalanceRow[];
  viewerUserId: string;
  maxRows?: number;
}) {
  const shown = finalBalances.slice(0, maxRows);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Final table</h2>
      <div className="overflow-hidden rounded-[24px] border border-hairline bg-surface">
        {shown.map((m, i) => {
          const isMe = m.user_id === viewerUserId;
          return (
            <div
              key={m.user_id}
              className={cn(
                'flex items-center gap-3 px-4 py-[14px]',
                i > 0 && 'border-t border-hairline',
                isMe && 'bg-canvas'
              )}
            >
              <span className="w-6 shrink-0 font-mono text-[12.5px] font-semibold text-faint">{i + 1}</span>
              <Mention nickname={m.nickname} className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-ink" />
              {isMe && <span className="shrink-0 text-[11.5px] font-bold text-faint uppercase">You</span>}
              <span className="shrink-0 font-mono text-[15px] font-semibold text-ink">{formatTokens(m.balance)}</span>
            </div>
          );
        })}
        {finalBalances.length > maxRows && (
          <Link
            href={`/groups/${groupId}/leaderboard?lens=current`}
            className="block border-t border-hairline px-4 py-3 text-[12.5px] font-bold text-signal hover:text-signal-deep"
          >
            Show all {finalBalances.length}
          </Link>
        )}
      </div>
    </div>
  );
}
