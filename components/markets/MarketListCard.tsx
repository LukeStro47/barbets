import Link from 'next/link';
import type { MarketCardData } from '@/components/markets/MarketCard';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { LockIcon } from '@/components/ui/icons';
import { RowChevron } from '@/components/ui/Screen';
import { formatTokens } from '@/lib/formatNumber';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { cn } from '@/lib/cn';

/**
 * The 4a/4b card shell — one bordered card per market (title, a 3-column stat row, an optional
 * action footer strip), replacing the grouped row-list (MarketRowList in MarketCard.tsx, still
 * used by PipelineGroupFeed/WindingDownCard) for the group hub's Open/Pending/Settled tabs. The
 * stat columns and footer strip vary by status/viewer-relationship, matching the design's own
 * per-state examples rather than one generic layout:
 *   open            — Pool / Bets / Closes, footer "Your bet" or "Place a bet"
 *   pending_sponsor — Proposed by / Waiting / Needs, footer "Endorse" or "waiting on someone else"
 *   proposed        — Called by / Says / Challenge, footer "Review the result"
 *   disputed        — same shape as proposed (a disputed market is still "awaiting resolution",
 *                      just past the challenge window into the secret ballot)
 *   resolved/voided — title + outcome only, no stat row (no explicit mock for the Settled tab
 *                      existed to match against, so this is the shell applied consistently
 *                      rather than guessed at in more detail)
 */

function StatCell({ label, value, valueClassName, first }: { label: string; value: React.ReactNode; valueClassName?: string; first?: boolean }) {
  return (
    <span className={cn('flex-1 py-[9px] pb-[10px]', first ? 'pl-4' : 'border-l border-rule pl-[13px]')}>
      <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</span>
      <span className={cn('mt-0.5 block truncate font-mono text-[13.5px] font-semibold text-ink', valueClassName)}>{value}</span>
    </span>
  );
}

function TextStatCell({ label, value, valueClassName, first }: { label: string; value: React.ReactNode; valueClassName?: string; first?: boolean }) {
  return (
    <span className={cn('flex-1 py-[9px] pb-[10px]', first ? 'pl-4' : 'border-l border-rule pl-[13px]')}>
      <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</span>
      <span className={cn('mt-0.5 block truncate text-[13px] font-bold text-ink', valueClassName)}>{value}</span>
    </span>
  );
}

function Footer({
  tone,
  left,
  right,
  chevron,
  quiet,
}: {
  tone: 'signal' | 'alert' | 'muted';
  left: React.ReactNode;
  right?: React.ReactNode;
  chevron: boolean;
  /** 4b's "Waiting on someone else to endorse": a status, not an action — faint and 600. */
  quiet?: boolean;
}) {
  const toneClasses =
    tone === 'signal'
      ? 'border-t border-signal-line bg-signal-wash text-signal'
      : tone === 'alert'
        ? 'border-t border-alert-line bg-alert-bg text-alert'
        : 'border-t border-rule bg-wash text-ink';
  return (
    <div className={cn('flex items-center justify-between gap-2.5 px-4 py-2.5', toneClasses)}>
      <span className={cn('min-w-0 truncate text-[12px]', quiet ? 'font-semibold text-faint' : 'font-bold')}>{left}</span>
      <span className="flex shrink-0 items-center gap-2">
        {right}
        {chevron && <RowChevron className={tone === 'muted' ? 'text-faint' : undefined} />}
      </span>
    </div>
  );
}

function MarketListCard({ market: m }: { market: MarketCardData }) {
  const isMultipleChoice = m.marketType === 'multiple_choice';
  const isRevealed = m.status === 'resolved' || m.status === 'voided';
  const href = `/groups/${m.groupId}/markets/${m.id}${isRevealed ? '/reveal' : ''}`;

  const proposedOutcome = m.proposedOutcomeLabel && (
    <OptionLabel label={isMultipleChoice ? m.proposedOutcomeLabel : m.proposedOutcomeLabel.toUpperCase()} />
  );

  return (
    <Link href={href} className="block overflow-hidden rounded-[18px] border border-hairline bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
      {m.mystery ? (
        <div className="flex items-center gap-2.5 px-4 pt-[13px] pb-[11px]">
          <LockIcon className="h-3.5 w-3.5 shrink-0 text-faint" />
          <p className="text-[15px] font-bold text-faint">A market about you</p>
        </div>
      ) : (
        <p className="px-4 pt-[14px] pb-3 text-[15px] leading-[1.3] font-bold tracking-[-0.01em] text-ink text-pretty">{m.title}</p>
      )}

      {m.status === 'open' && (
        <div className="flex border-t border-rule">
          <StatCell first label="Pool" value={formatTokens(m.openPool ?? 0)} />
          <StatCell label="Bets" value={m.openBetCount ?? 0} />
          <StatCell label="Closes" value={<CountdownTimer target={m.closesAt} prefix="" />} valueClassName="text-signal" />
        </div>
      )}

      {m.status === 'pending_sponsor' && (
        <div className="flex border-t border-rule">
          <TextStatCell first label="Proposed by" value={m.proposerLabel ?? '—'} />
          <StatCell label="Waiting" value={m.createdAt ? formatRelativeTime(m.createdAt).replace(' ago', '') : '—'} />
          <StatCell label="Needs" value="1" valueClassName={m.canEndorse ? 'text-alert' : undefined} />
        </div>
      )}

      {(m.status === 'proposed' || m.status === 'disputed') && !m.mystery && (
        <div className="flex border-t border-rule">
          <TextStatCell first label="Called by" value={m.calledByLabel ?? '—'} />
          <TextStatCell label="Says" value={proposedOutcome ?? '—'} />
          {m.status === 'proposed' && m.challengeDeadline ? (
            <StatCell label="Challenge" value={<CountdownTimer target={m.challengeDeadline} prefix="" />} valueClassName="text-signal" />
          ) : (
            <StatCell label="Bets" value={m.closedBetCount ?? 0} />
          )}
        </div>
      )}

      {isRevealed && !m.mystery && (
        <div className="border-t border-rule px-4 py-2.5">
          <p className="text-[13px] font-bold text-muted">
            {m.outcome === 'void' ? (
              'Voided, everyone refunded'
            ) : (
              <>
                {(isMultipleChoice ? m.outcomeLabel : m.outcome)?.toUpperCase()}
                {m.myNet != null && m.myNet !== 0 && (
                  <span className={m.myNet > 0 ? 'text-gain' : 'text-alert'}> · {formatTokens(Math.abs(m.myNet))} {m.myNet > 0 ? 'won' : 'lost'}</span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {m.status === 'open' &&
        !m.mystery &&
        (m.myBets && m.myBets.length > 0 ? (
          <Footer
            tone="signal"
            left="Your bet"
            right={<span className="font-mono text-[13px] font-semibold text-signal">{m.myBets.map((b) => `${formatTokens(b.amount)} on ${b.label}`).join(', ')}</span>}
            chevron={false}
          />
        ) : (
          <Footer tone="muted" left="Place a bet" chevron />
        ))}

      {m.status === 'pending_sponsor' &&
        (m.canEndorse ? <Footer tone="alert" left="Endorse" chevron /> : <Footer tone="muted" quiet left="Waiting on someone else to endorse" chevron={false} />)}

      {(m.status === 'proposed' || m.status === 'disputed') &&
        !m.mystery &&
        (m.myBetLabel ? (
          <Footer tone="signal" left={`Review the result · ${m.myBetLabel}`} chevron />
        ) : (
          <Footer tone="muted" left={m.status === 'disputed' ? 'See how the vote is going' : 'See the proposed result'} chevron />
        ))}
    </Link>
  );
}

export function MarketCardList({ markets, gap = 8 }: { markets: MarketCardData[]; gap?: number }) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {markets.map((m) => (
        <MarketListCard key={m.id} market={m} />
      ))}
    </div>
  );
}
