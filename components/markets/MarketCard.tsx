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
import { cn } from '@/lib/cn';

export interface MarketCardData {
  id: string;
  groupId: string;
  title: string;
  status: MarketStatus;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  closesAt: string;
  /** When betting actually closed (resolved/voided markets only) — used to order the resolved list. */
  closedAt?: string | null;
  outcome: string | null;
  /** over_under only. */
  line?: number | null;
  /** over_under only, e.g. "$", "min", "pts". */
  unit?: string | null;
  /** multiple_choice resolved markets: the winning option's label (outcome stays null). */
  outcomeLabel?: string | null;
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
            <CountdownTimer target={market.closesAt} prefix="Betting closes" />
          </div>
        )}

        {market.status === 'open' && (
          <div className="flex items-center justify-between text-sm text-espresso-500">
            <span>🤫 {market.openBetCount ?? 0} bets placed</span>
            <CountdownTimer target={market.closesAt} />
          </div>
        )}

        {['closed', 'proposed', 'disputed'].includes(market.status) && (
          <>
            {market.closedBetCount !== undefined && (
              <p className="text-xs text-espresso-400">{market.closedBetCount} bets placed</p>
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
            {market.outcome === 'void'
              ? 'Voided, everyone refunded'
              : `Outcome: ${(isMultipleChoice ? market.outcomeLabel : market.outcome)?.toUpperCase()}`}
          </p>
        )}
      </Card>
    </Link>
  );
}

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

  if (market.status === 'pending_sponsor') {
    return (
      <p className="mt-0.5 text-xs text-espresso-400">
        <CountdownTimer target={market.closesAt} prefix="Betting closes" />
      </p>
    );
  }

  if (market.status === 'open') {
    return (
      <p className="mt-0.5 text-xs text-espresso-400">
        {market.openBetCount ?? 0} bets · <CountdownTimer target={market.closesAt} />
      </p>
    );
  }

  if (['closed', 'proposed', 'disputed'].includes(market.status)) {
    const betCountPrefix = market.closedBetCount !== undefined ? `${market.closedBetCount} bets · ` : '';
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
        Outcome: {isMultipleChoice ? <OptionLabel label={market.outcomeLabel ?? ''} /> : market.outcome?.toUpperCase()}
      </p>
    );
  }

  return null;
}

function MarketRow({ market, isLast }: { market: MarketCardData; isLast: boolean }) {
  const isRevealed = market.status === 'resolved' || market.status === 'voided';
  const href = `/groups/${market.groupId}/markets/${market.id}${isRevealed ? '/reveal' : ''}`;
  const Icon = STATUS_ROW_ICON[market.status];

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-[18px] py-[14px] transition-colors hover:bg-espresso-50/25',
        !isLast && 'border-b border-espresso-50'
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]', TONE_CLASSES[STATUS_TONE[market.status]])}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-semibold leading-[1.3] text-espresso-900">{market.title}</p>
        <MarketRowMeta market={market} />
      </span>
      {market.needsAttention && <AttentionBadge />}
      {market.reactionGlyphs && market.reactionGlyphs.length > 0 && <ReactionFacepile glyphs={market.reactionGlyphs} />}
      <ChevronRightIcon className="h-3.5 w-2 shrink-0 text-espresso-200" />
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
