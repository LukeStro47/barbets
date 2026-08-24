import Link from 'next/link';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import type { FinalBalanceRow } from '@/components/groups/SeasonRecapHero';

const MEDAL = ['🥇', '🥈', '🥉'];

/** The frozen standings from `season_results.snapshot.final_balances`, top rows plus a link to
 * the full table on Leaderboard — same honey-fill-bar-by-share-of-leader treatment the live
 * standings card uses, just against a snapshot instead of live balances. */
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
  const leaderBalance = finalBalances[0]?.balance || 1;
  const shown = finalBalances.slice(0, maxRows);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-xs font-bold tracking-[0.08em] text-espresso-400 uppercase">Final table</h2>
      <div className="flex flex-col gap-1.5 rounded-[22px] border border-espresso-100 bg-paper-white p-3">
        {shown.map((m, i) => {
          const isMe = m.user_id === viewerUserId;
          const pct = Math.max(9, Math.round((m.balance / leaderBalance) * 100));
          return (
            <div
              key={m.user_id}
              className={cn(
                'relative h-[50px] overflow-hidden rounded-[14px] bg-espresso-50',
                isMe && 'border-[1.5px] border-honey-500'
              )}
            >
              <span
                className={cn('absolute inset-y-0 left-0', isMe ? 'bg-honey-500' : 'bg-honey-500/30')}
                style={{ width: `${pct}%` }}
              />
              <span className="absolute inset-0 flex items-center gap-2.5 px-3">
                <span className="w-5 shrink-0 text-center text-xs font-extrabold text-espresso-500">
                  {MEDAL[i] ?? `${i + 1}.`}
                </span>
                <Mention nickname={m.nickname} className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-espresso-900" />
                <span className="shrink-0 font-display text-[15px] font-extrabold text-espresso-900">{formatTokens(m.balance)}</span>
              </span>
            </div>
          );
        })}
        {finalBalances.length > maxRows && (
          <Link href={`/groups/${groupId}/leaderboard?lens=current`} className="px-1 pt-1 text-[12.5px] font-bold text-honey-700 hover:text-honey-800">
            Show all {finalBalances.length} →
          </Link>
        )}
      </div>
    </div>
  );
}
