import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StatStrip, StatTile } from '@/components/markets/StatStrip';
import { ClosesInStatTile } from '@/components/markets/ClosesInStatTile';
import { OddsBar } from '@/components/markets/OddsBar';
import { STATUS_LABEL, STATUS_TONE, type MarketStatus } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';

export interface SubjectMarketPulseData {
  status: MarketStatus;
  market_type: 'yes_no' | 'over_under' | 'multiple_choice';
  closes_at: string;
  bet_count: number;
  pool_amount: number;
}

export interface SubjectMarketPulseSide {
  side: string;
  pool_amount: number;
  bet_count: number;
  pool_percent: number;
}

/** What a subject sees instead of the real market page — get_subject_market_pulse(_sides)
 * deliberately hands back nothing that could identify what the market is about (no title, no
 * description, no other members involved), just the live shape of the action: bet count, total
 * volume, and (for yes_no/over_under) the odds split. Odds show even while the market is still
 * 'open', unlike the real page's get_closed_odds gate for everyone else — that gate exists so a
 * bettor can't be swayed by live odds while they can still act on them, which doesn't apply here
 * since a subject can never place a bet on a market about themselves in the first place. */
export function SubjectMarketPulse({
  groupId,
  pulse,
  sides,
}: {
  groupId: string;
  pulse: SubjectMarketPulseData;
  sides: SubjectMarketPulseSide[] | null;
}) {
  const [sideA, sideB] = pulse.market_type === 'yes_no' ? ['yes', 'no'] : ['over', 'under'];
  const oddsA = sides?.find((s) => s.side === sideA);
  const oddsB = sides?.find((s) => s.side === sideB);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="A market about you"
        backHref={`/groups/${groupId}`}
        backLabel="Group"
        backAction={<Badge tone={STATUS_TONE[pulse.status]}>{STATUS_LABEL[pulse.status]}</Badge>}
      />

      <StatStrip>
        {pulse.status === 'open' && <ClosesInStatTile closesAt={pulse.closes_at} />}
        <StatTile label="Bets" value={pulse.bet_count} />
        {pulse.pool_amount > 0 && <StatTile label="Volume" value={formatTokens(pulse.pool_amount)} />}
      </StatStrip>

      <Card className="space-y-3">
        <p className="text-espresso-600">
          Someone in the group started a market about you. What it's about, who's betting, and how it resolves all
          stay hidden until then — this is as much as there is to see for now.
        </p>
        {oddsA && oddsB && (
          <OddsBar
            left={{ label: sideA.toUpperCase(), percent: oddsA.pool_percent }}
            right={{ label: sideB.toUpperCase(), percent: oddsB.pool_percent }}
          />
        )}
      </Card>
    </main>
  );
}
