import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { STATUS_LABEL, STATUS_TONE, type MarketStatus } from '@/lib/marketStatus';

export interface MarketCardData {
  id: string;
  groupId: string;
  title: string;
  status: MarketStatus;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  closesAt: string;
  outcome: string | null;
  /** over_under only. */
  line?: number | null;
  /** multiple_choice resolved markets: the winning option's label (outcome stays null). */
  outcomeLabel?: string | null;
  openBetCount?: number;
  odds?: { side: string; percent: number }[];
  optionOdds?: { id: string; label: string; percent: number }[];
  /** Shown as a small label above the title — only needed in cross-group contexts like the inbox feed. */
  groupName?: string;
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
          <Badge tone={STATUS_TONE[market.status]}>{STATUS_LABEL[market.status]}</Badge>
        </div>

        {market.status === 'pending_sponsor' && isMultipleChoice && (
          <span className="inline-block rounded-full bg-espresso-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-espresso-600">
            Multiple choice
          </span>
        )}

        {market.status === 'open' && (
          <div className="flex items-center justify-between text-sm text-espresso-500">
            <span>🤫 {market.openBetCount ?? 0} bets placed</span>
            <CountdownTimer target={market.closesAt} />
          </div>
        )}

        {['closed', 'proposed', 'disputed'].includes(market.status) &&
          (isMultipleChoice ? (market.optionOdds?.length ?? 0) > 0 && <OddsBarMulti options={market.optionOdds!} /> : oddsA && oddsB && (
            <OddsBar
              left={{ label: sideA.toUpperCase(), percent: oddsA.percent }}
              right={{ label: sideB.toUpperCase(), percent: oddsB.percent }}
              center={market.marketType === 'over_under' ? market.line ?? undefined : undefined}
            />
          ))}

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
