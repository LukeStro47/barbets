import type { ComponentType } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge, TONE_CLASSES } from '@/components/ui/Badge';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ChevronRightIcon, FlagIcon, TargetIcon, ClockIcon, AlertTriangleIcon, CheckCircleIcon } from '@/components/ui/icons';
import { STATUS_LABEL, STATUS_TONE, type MarketStatus } from '@/lib/marketStatus';
import { formatLine } from '@/lib/units';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

export interface MarketCardData {
  id: string;
  groupId: string;
  title: string;
  status: MarketStatus;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  closesAt: string;
  /** pending_sponsor only: the sooner of 24h-since-creation or 5-minutes-before-closes_at — the actual deadline to endorse before it auto-voids. */
  sponsorDeadline?: string;
  /** When a market actually resolved (resolved/voided only) — used to order the resolved list. */
  resolvedAt?: string | null;
  outcome: string | null;
  /** over_under only. */
  line?: number | null;
  /** over_under only, e.g. "$", "min", "pts". */
  unit?: string | null;
  /** multiple_choice resolved markets: the winning option's label (outcome stays null). */
  outcomeLabel?: string | null;
  /** proposed/disputed only: the resolution that's currently on the table. */
  proposedOutcomeLabel?: string;
  openBetCount?: number;
  /** Total bets across all sides/options, once betting has closed. */
  closedBetCount?: number;
  odds?: { side: string; percent: number }[];
  optionOdds?: { id: string; label: string; percent: number }[];
  /** Shown as a small label above the title — only needed in cross-group contexts like the inbox feed. */
  groupName?: string;
  /** True when the viewer has something blocking on them specifically for this market (currently: an open clarification request they created the market for) — renders a small exclamation badge. */
  needsAttention?: boolean;
  /** Distinct reaction glyphs present on a resolved/voided market, in REACTIONS canonical order — renders a compact view-only facepile. Mutually exclusive with needsAttention in practice (only open markets can need attention; only resolved/voided ones can have reactions), so they share the same badge slot. */
  reactionGlyphs?: string[];
  /** resolved/voided only: the viewer's own total payout minus total stake across every bet they placed on this market (summed, in case of a hedge — same convention the "Resolved" push copy uses). Undefined when the viewer never bet on it; always 0 for a void (refund = stake back), so it never renders a won/lost suffix. */
  myNet?: number;
  /** open only: every bet the viewer has placed on this market so far (more than one entry means a hedge across sides/options). Undefined/empty when they haven't bet on it yet. */
  myBets?: { label: string; amount: number }[];
  /** True for a market the viewer is a hidden subject of — title is always the literal string "???" (no title/description ever reaches the client for these), and every status-specific rendering below is skipped in favor of a bare bet-count/closes-in line. Sourced from get_subject_market_pulse_for_group, never from visible_markets. */
  mystery?: boolean;
}

function AttentionBadge() {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger-100 text-xs font-bold text-danger-700"
      title="Needs clarification"
    >
      !
    </span>
  );
}

/** Compact, view-only reaction facepile for market list rows/cards — same overlapping-glyph treatment as the interactive ReactionBar trigger, just smaller and non-clickable. */
function ReactionFacepile({ glyphs }: { glyphs: string[] }) {
  return (
    <span className="flex shrink-0 items-center">
      {glyphs.map((glyph, i) => (
        <span key={i} className="-ml-1.5 flex h-5 w-5 items-center justify-center text-xs first:ml-0" style={{ zIndex: glyphs.length - i }}>
          {glyph}
        </span>
      ))}
    </span>
  );
}

/** "N won" (success-green) or "N lost" (danger-red) appended next to a resolved market's
    outcome, when the viewer had a bet on it. Renders nothing for an undefined or zero myNet —
    undefined means the viewer never bet on it, zero means a void refund or (rare) an exact
    stake-back. */
function MyNetLabel({ myNet }: { myNet?: number }) {
  if (!myNet) return null;
  return myNet > 0 ? (
    <span className="text-success-700"> · {formatTokens(myNet)} won</span>
  ) : (
    <span className="text-danger-700"> · {formatTokens(Math.abs(myNet))} lost</span>
  );
}

/** The viewer's own position on an open market — as a wrapped row of small chips ("50 YES",
    "20 NO" for a hedge) rather than a run-on "You: 50 on YES, 20 on NO" sentence, which reads
    fine for one bet but wraps mid-phrase once hedged across a couple of sides/options,
    especially in the narrow MarketRow layout. Chips wrap as whole units instead. No "You" label
    on the chips themselves — every other card in this list has none, so a bare chip already
    reads as "your stake" by contrast. */
function MyBetsChips({ myBets }: { myBets?: { label: string; amount: number }[] }) {
  if (!myBets || myBets.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {myBets.map((b, i) => (
        <span key={i} className="rounded-full bg-honey-100 px-2 py-0.5 text-[11px] font-bold text-honey-800">
          {formatTokens(b.amount)} {b.label}
        </span>
      ))}
    </div>
  );
}

export function MarketCard({ market }: { market: MarketCardData }) {
  const isMultipleChoice = market.marketType === 'multiple_choice';
  const [sideA, sideB] = market.marketType === 'yes_no' ? ['yes', 'no'] : ['over', 'under'];
  const oddsA = market.odds?.find((o) => o.side === sideA);
  const oddsB = market.odds?.find((o) => o.side === sideB);
  const isRevealed = market.status === 'resolved' || market.status === 'voided';
  const href = `/groups/${market.groupId}/markets/${market.id}${isRevealed ? '/reveal' : ''}`;

  return (
    <Link href={href}>
      <Card className="space-y-3 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            {market.groupName && <p className="text-xs font-semibold uppercase tracking-wide text-honey-700">{market.groupName}</p>}
            <p className="font-display font-bold leading-snug text-espresso-900">{market.title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {market.needsAttention && <AttentionBadge />}
            {market.reactionGlyphs && market.reactionGlyphs.length > 0 && <ReactionFacepile glyphs={market.reactionGlyphs} />}
            <Badge tone={STATUS_TONE[market.status]}>{STATUS_LABEL[market.status]}</Badge>
          </div>
        </div>

        {market.status === 'pending_sponsor' && (
          <div className="flex items-center justify-between text-sm text-espresso-500">
            {isMultipleChoice ? (
              <span className="inline-block rounded-full bg-espresso-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-espresso-600">
                Multiple choice
              </span>
            ) : (
              <span />
            )}
            <CountdownTimer target={market.sponsorDeadline ?? market.closesAt} prefix="Time to endorse:" />
          </div>
        )}

        {market.status === 'open' && (
          <div>
            <div className="flex items-center justify-between text-sm text-espresso-500">
              <span>🤫 {market.openBetCount ?? 0} bets placed</span>
              <CountdownTimer target={market.closesAt} />
            </div>
            <MyBetsChips myBets={market.myBets} />
          </div>
        )}

        {['closed', 'proposed', 'disputed'].includes(market.status) && (
          <>
            {market.closedBetCount !== undefined && (
              <p className="text-xs text-espresso-400">{market.closedBetCount} bets placed</p>
            )}
            {market.proposedOutcomeLabel && (
              <p className="text-sm font-semibold text-espresso-700">
                Proposed: <OptionLabel label={market.proposedOutcomeLabel.toUpperCase()} />
              </p>
            )}
            {isMultipleChoice ? (market.optionOdds?.length ?? 0) > 0 && <OddsBarMulti options={market.optionOdds!} /> : oddsA && oddsB && (
              <OddsBar
                left={{ label: sideA.toUpperCase(), percent: oddsA.percent }}
                right={{ label: sideB.toUpperCase(), percent: oddsB.percent }}
                center={market.marketType === 'over_under' && market.line != null ? formatLine(market.line, market.unit) : undefined}
              />
            )}
          </>
        )}

        {['resolved', 'voided'].includes(market.status) && (
          <p className="text-sm font-semibold text-espresso-600">
            {market.outcome === 'void' ? (
              'Voided, everyone refunded'
            ) : (
              <>
                {(isMultipleChoice ? market.outcomeLabel : market.outcome)?.toUpperCase()}
                <MyNetLabel myNet={market.myNet} />
              </>
            )}
          </p>
        )}
      </Card>
    </Link>
  );
}

/** The row-list's status icon tile — colored via the same 3-tone system as STATUS_TONE
 * (danger = needs you, ink = live, neutral = informational/done), each with its own glyph so
 * status reads at a glance without needing to decode a bare color. */
const STATUS_ROW_ICON: Record<MarketStatus, ComponentType<{ className?: string }>> = {
  pending_sponsor: FlagIcon,
  open: TargetIcon,
  closed: ClockIcon,
  proposed: ClockIcon,
  disputed: AlertTriangleIcon,
  resolved: CheckCircleIcon,
  voided: CheckCircleIcon,
};

function MarketRowMeta({ market }: { market: MarketCardData }) {
  const isMultipleChoice = market.marketType === 'multiple_choice';
  const [sideA, sideB] = market.marketType === 'yes_no' ? ['yes', 'no'] : ['over', 'under'];

  // None of the status-specific branches below apply — a hidden-subject market has no odds,
  // no proposed outcome, nothing to show beyond that it exists and roughly when it closes.
  if (market.mystery) {
    return (
      <p className="mt-0.5 text-xs text-espresso-400">
        {market.openBetCount ?? market.closedBetCount ?? 0} bets · <CountdownTimer target={market.closesAt} />
      </p>
    );
  }

  if (market.status === 'pending_sponsor') {
    return (
      <p className="mt-0.5 text-xs text-espresso-400">
        <CountdownTimer target={market.sponsorDeadline ?? market.closesAt} prefix="Time to endorse:" />
      </p>
    );
  }

  if (market.status === 'open') {
    // A single position now shows as the row's trailing pill instead (see MarketRow) — the
    // chips here are only needed for a hedge, where more than one position won't fit there.
    const showChips = (market.myBets?.length ?? 0) > 1;
    return (
      <>
        <p className="mt-0.5 text-xs text-espresso-400">
          {market.openBetCount ?? 0} bets · <CountdownTimer target={market.closesAt} />
        </p>
        {showChips && <MyBetsChips myBets={market.myBets} />}
      </>
    );
  }

  if (['closed', 'proposed', 'disputed'].includes(market.status)) {
    const betCountPrefix = market.closedBetCount !== undefined ? `${market.closedBetCount} bets · ` : '';
    if (market.proposedOutcomeLabel) {
      return (
        <p className="mt-0.5 text-xs text-espresso-400">
          {betCountPrefix}Proposed: <OptionLabel label={market.proposedOutcomeLabel.toUpperCase()} />
        </p>
      );
    }
    if (isMultipleChoice) {
      const top = [...(market.optionOdds ?? [])].sort((a, b) => b.percent - a.percent)[0];
      if (!top) return null;
      return (
        <p className="mt-0.5 text-xs text-espresso-400">
          {betCountPrefix}
          <OptionLabel label={top.label} /> leading · {top.percent}%
        </p>
      );
    }
    const oddsA = market.odds?.find((o) => o.side === sideA);
    const oddsB = market.odds?.find((o) => o.side === sideB);
    if (!oddsA || !oddsB) return null;
    return (
      <p className="mt-0.5 text-xs text-espresso-400">
        {betCountPrefix}
        {sideA.toUpperCase()} {oddsA.percent}% · {sideB.toUpperCase()} {oddsB.percent}%
      </p>
    );
  }

  if (market.status === 'resolved' || market.status === 'voided') {
    if (market.outcome === 'void') {
      return <p className="mt-0.5 text-xs text-espresso-400">Voided, everyone refunded</p>;
    }
    return (
      <p className="mt-0.5 text-xs text-espresso-400">
        {isMultipleChoice ? <OptionLabel label={market.outcomeLabel ?? ''} /> : market.outcome?.toUpperCase()}
        <MyNetLabel myNet={market.myNet} />
      </p>
    );
  }

  return null;
}

function MarketRow({ market, isLast }: { market: MarketCardData; isLast: boolean }) {
  const isRevealed = market.status === 'resolved' || market.status === 'voided';
  const href = `/groups/${market.groupId}/markets/${market.id}${isRevealed ? '/reveal' : ''}`;
  const showBetPill = market.status === 'open' && !market.mystery;
  // A single position fits in the trailing pill itself (replacing "Add" with what you actually
  // bet); a hedge across sides/options can't, so that case falls back to a plain "Add" and
  // keeps its breakdown in the chips under the title instead (see MarketRowMeta below).
  const singleBet = market.myBets?.length === 1 ? market.myBets[0] : null;
  const Icon = STATUS_ROW_ICON[market.status];

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-4 py-[14px] transition-colors hover:bg-espresso-50/25',
        market.mystery && 'bg-honey-50',
        !isLast && 'border-b border-espresso-50'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]',
          market.mystery ? 'bg-espresso-900 text-honey-300' : TONE_CLASSES[STATUS_TONE[market.status]]
        )}
      >
        {market.mystery ? <span className="text-[17px] font-extrabold leading-none">?</span> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <p className="font-display text-[15.5px] font-bold leading-[1.25] text-espresso-950">
          {market.mystery ? 'A market about you' : market.title}
        </p>
        <MarketRowMeta market={market} />
      </span>
      {market.needsAttention && <AttentionBadge />}
      {market.reactionGlyphs && market.reactionGlyphs.length > 0 && <ReactionFacepile glyphs={market.reactionGlyphs} />}
      {showBetPill ? (
        singleBet ? (
          <span className="shrink-0 rounded-full bg-honey-100 px-3 py-[5px] text-xs font-bold text-honey-800">
            {formatTokens(singleBet.amount)} {singleBet.label}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border-[1.5px] border-espresso-200 px-3 py-[5px] text-xs font-bold text-espresso-800">
            {market.myBets && market.myBets.length > 0 ? 'Add' : 'Bet'}
          </span>
        )
      ) : (
        <ChevronRightIcon className="h-3.5 w-2 shrink-0 text-espresso-200" />
      )}
    </Link>
  );
}

/** The 1b redesign's grouped-list variant: one rounded container per status bucket, each market a row inside it instead of its own card. */
export function MarketRowList({ markets }: { markets: MarketCardData[] }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-espresso-100 bg-paper-white">
      {markets.map((m, i) => (
        <MarketRow key={m.id} market={m} isLast={i === markets.length - 1} />
      ))}
    </div>
  );
}
