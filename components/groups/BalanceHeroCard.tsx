import { formatOrdinal, formatSignedTokens, formatTokens } from '@/lib/formatNumber';

/**
 * Markets hub balance surface (DESIGN.md + feed mock). White card, mono hero figure, optional
 * gain chip for realised net, and a single muted meta line for in-play / standing / accuracy.
 * Invite lives on Manage group, not here.
 */
export function BalanceHeroCard({
  balance,
  pendingTokens,
  net,
  rank,
  playerCount,
  accuracyPct,
}: {
  balance: number;
  pendingTokens: number;
  /** All-time ledger net in this group. Chip only renders for a realised gain. */
  net: number;
  rank: number | null;
  playerCount: number;
  accuracyPct: number | null;
}) {
  const meta: string[] = [];
  if (pendingTokens > 0) meta.push(`${formatTokens(pendingTokens)} in play`);
  if (rank != null && playerCount > 0) meta.push(`${formatOrdinal(rank)} of ${playerCount}`);
  if (accuracyPct != null) meta.push(`${accuracyPct}% accuracy`);

  return (
    <div className="rounded-[24px] border border-hairline bg-surface px-5 py-[18px] shadow-[var(--elevation-card)]">
      <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Free to bet</p>
      <div className="mt-1.5 flex items-end gap-2.5">
        <p className="font-mono text-[42px] leading-none font-semibold tracking-[-0.03em] text-ink">
          {formatTokens(balance)}
        </p>
        {net > 0 && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-[8px] bg-gain-bg px-2 py-[3px] font-mono text-[12.5px] font-semibold text-gain">
            <TrendUpIcon />
            {formatSignedTokens(net)}
          </span>
        )}
      </div>
      {meta.length > 0 && <p className="mt-3 text-[12.5px] text-muted">{meta.join(' · ')}</p>}
    </div>
  );
}

function TrendUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1.5 8.5 4.5 5.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 4h2.5V6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
