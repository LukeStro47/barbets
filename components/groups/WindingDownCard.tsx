import Link from 'next/link';
import { ClockIcon } from '@/components/ui/icons';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens } from '@/lib/formatNumber';
import type { MarketCardData } from '@/components/markets/MarketCard';

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
  youLead,
  gapValue,
  stillResolving,
}: {
  groupId: string;
  seasonName: string;
  yourRank: number | null;
  totalPlayers: number;
  yourBalance: number;
  youLead: boolean;
  gapValue: number;
  stillResolving: MarketCardData[];
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative overflow-hidden rounded-[24px] bg-ink px-5 py-[18px]">
        <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_90%_0%,rgba(232,163,61,0.3),rgba(232,163,61,0)_60%)]" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="h-[7px] w-[7px] rounded-full bg-signal" />
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-signal uppercase">Final stretch</p>
          </div>
          <p className="mt-2 font-display text-xl leading-[1.15] font-extrabold tracking-[-0.015em] text-white">
            {seasonName} is closing
          </p>
          <p className="mt-1.5 text-[13px] text-white/55">
            No new markets. {stillResolving.length} still resolving, then the table is final.
          </p>
          <div className="mt-3.5 flex gap-3 border-t border-white/10 pt-3">
            <span className="flex-1">
              <span className="block text-[17px] font-extrabold text-white">{yourRank ? `${yourRank}` : '—'}</span>
              <span className="block text-[10px] font-extrabold tracking-[0.07em] text-white/45 uppercase">
                {yourRank ? `you, of ${totalPlayers}` : `${totalPlayers} playing`}
              </span>
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-extrabold text-on-ink">{formatTokens(yourBalance)}</span>
              <span className="block text-[10px] font-extrabold tracking-[0.07em] text-white/45 uppercase">your tokens</span>
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-extrabold text-white">{formatTokens(gapValue)}</span>
              <span className="block text-[10px] font-extrabold tracking-[0.07em] text-white/45 uppercase">
                {youLead ? 'clear of 2nd' : 'behind the leader'}
              </span>
            </span>
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
                {m.status === 'disputed' && (
                  <span className="shrink-0 rounded-full bg-ink px-3.5 py-[7px] text-[12.5px] font-bold text-white">Vote</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
