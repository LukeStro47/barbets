import Link from 'next/link';
import { ClockIcon } from '@/components/ui/icons';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens, formatSignedTokens, formatOrdinal } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import type { MarketCardData } from '@/components/markets/MarketCard';
import type { GroupTask } from '@/lib/tasks';

/**
 * Replaces SeasonBanner's flat "still resolving a few markets" notice. The stat strip reuses
 * the same rank/gap math the Leaderboard hero computes live (leaderboard/page.tsx); the
 * "still resolving" rows are exactly getActiveMarkets()'s awaiting_resolution + challenged
 * buckets, already fetched on the group hub page for the normal Pending tab — no new query.
 *
 * Only `proposed` and `disputed` markets can appear here: _end_season force-voids
 * pending_sponsor/open/closed synchronously the moment the season ends, so a market that
 * survives into winding_down is always mid-challenge-window or mid-vote, never "waiting on
 * someone to propose an outcome" (a state that can't exist at this point).
 */
export function WindingDownCard({
  groupId,
  seasonName,
  yourRank,
  totalPlayers,
  yourBalance,
  yourNet,
  inPlay,
  youLead,
  gapValue,
  stillResolving,
  yourTasks,
}: {
  groupId: string;
  seasonName: string;
  yourRank: number | null;
  totalPlayers: number;
  yourBalance: number;
  /** All-time net in this group (the hub's green/red pill), shown beside the balance. */
  yourNet: number;
  /** Tokens still riding on the markets that are resolving. */
  inPlay: number;
  youLead: boolean;
  gapValue: number;
  stillResolving: MarketCardData[];
  /** getGroupTasks() for this viewer. The hub hides WaitingOnYouCard while winding down, so this
   *  list is the only place that says which of these results is waiting on you specifically. */
  yourTasks: GroupTask[];
}) {
  const taskFor = new Map(yourTasks.map((t) => [t.marketId, t.type]));
  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative overflow-hidden rounded-[24px] bg-ink px-5 py-[18px]">
        <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_90%_0%,rgba(45,85,245,0.3),rgba(45,85,245,0)_60%)]" />
        <div className="relative">
          <p className="text-[10.5px] font-bold tracking-[0.12em] text-signal uppercase">Final stretch</p>
          <p className="mt-2 font-display text-xl leading-[1.15] font-extrabold tracking-[-0.015em] text-surface">
            {seasonName} is closing
          </p>
          <p className="mt-1.5 text-[13px] text-surface/55">
            No new markets. {stillResolving.length} still resolving, then the table is final.
          </p>
          {/* Free to bet leads the card: while winding down the hub hides its own Free to bet card, so
              this is the one place the balance is shown. */}
          <div className="mt-4 border-t border-white/10 pt-3.5">
            <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Free to bet</p>
            <div className="mt-1.5 flex items-end justify-between gap-3.5">
              <p className="font-mono text-[40px] leading-none font-semibold tracking-[-0.03em] text-surface">{formatTokens(yourBalance)}</p>
              {yourNet !== 0 && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-[5px] rounded-[8px] px-[9px] py-[5px] font-mono text-[13px] font-semibold text-surface',
                    yourNet > 0 ? 'bg-gain' : 'bg-alert'
                  )}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d={yourNet > 0 ? 'M2 8.5 5 5l2 2 3-4' : 'M2 3.5 5 7l2-2 3 4'} />
                  </svg>
                  {formatSignedTokens(yourNet)}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-[9px] gap-y-1 border-t border-white/10 pt-[11px] font-mono text-xs text-faint">
              <span>
                <span className="font-semibold text-surface">{formatTokens(inPlay)}</span> in play
              </span>
              <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-white/25" />
              <span>
                <span className="font-semibold text-surface">{yourRank ? formatOrdinal(yourRank) : '—'}</span> of {totalPlayers}
              </span>
              <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-white/25" />
              <span>
                <span className="font-semibold text-surface">{formatTokens(gapValue)}</span> {youLead ? 'clear of 2nd' : 'behind the leader'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {stillResolving.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="ml-1 text-xs font-bold tracking-[0.08em] text-faint uppercase">Still resolving</h2>
          <div className="overflow-hidden rounded-[22px] border border-hairline bg-surface">
            {stillResolving.map((m, i) => (
              <Link
                key={m.id}
                href={`/groups/${groupId}/markets/${m.id}`}
                className={`flex items-center gap-3 px-4 py-[14px] transition-colors hover:bg-rule/25 ${
                  i < stillResolving.length - 1 ? 'border-b border-rule' : ''
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] ${
                    m.status === 'disputed' ? 'bg-alert-bg text-alert' : 'bg-rule text-muted'
                  }`}
                >
                  <ClockIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <p className="font-display text-[15.5px] leading-[1.25] font-bold text-ink">{m.title}</p>
                  <p className={`mt-0.5 text-xs ${m.status === 'disputed' ? 'text-alert' : 'text-faint'}`}>
                    {m.status === 'disputed'
                      ? 'A vote is open on the result'
                      : m.proposedOutcomeLabel
                        ? (
                          <>
                            Proposed: <OptionLabel label={m.proposedOutcomeLabel.toUpperCase()} />, challenge window open
                          </>
                        )
                        : 'Awaiting a proposed result'}
                  </p>
                </span>
                {(taskFor.get(m.id) === 'vote' || taskFor.get(m.id) === 'review') && (
                  <span className="shrink-0 rounded-full bg-ink px-3.5 py-[7px] text-[12.5px] font-bold text-surface">
                    {taskFor.get(m.id) === 'vote' ? 'Vote' : 'Review'}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
