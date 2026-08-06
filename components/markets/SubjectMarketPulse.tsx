import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { SealedTicketCover } from '@/components/markets/SealedTicketCover';
import { STATUS_LABEL, STATUS_TONE, type MarketStatus } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';

export interface SubjectMarketPulseData {
  status: MarketStatus;
  market_type: 'yes_no' | 'over_under' | 'multiple_choice';
  closes_at: string;
  bet_count: number;
  pool_amount: number;
}

/** What a subject sees instead of the real market page — a wax-sealed ticket, matching the
 * reveal ticket's visual language but with both halves opaque. get_subject_market_pulse
 * deliberately hands back nothing that could identify what the market is about (no title, no
 * description, no other members involved, and — as of this redesign — no odds either, since
 * that's now judged not worth the crack it would otherwise be fine to make): just the coarse
 * shape of the action (bet count, total volume, time to close) surfaced in the "what you can
 * see" panel below the seal. It really does tear open the moment the market resolves —
 * see RevealTicket's `sealedForSubject` prop for that half of the story. */
export function SubjectMarketPulse({
  groupId,
  groupName,
  pulse,
}: {
  groupId: string;
  groupName: string;
  pulse: SubjectMarketPulseData;
}) {
  const stats: { label: string; value: React.ReactNode }[] = [{ label: 'Bets', value: pulse.bet_count }];
  if (pulse.pool_amount > 0) stats.push({ label: 'Volume', value: formatTokens(pulse.pool_amount) });
  if (pulse.status === 'open') stats.push({ label: 'Closes', value: <CountdownTimer target={pulse.closes_at} prefix="" /> });

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="A market about you"
        backHref={`/groups/${groupId}`}
        backLabel={groupName}
        backAction={<Badge tone={STATUS_TONE[pulse.status]}>{STATUS_LABEL[pulse.status]}</Badge>}
      />

      <SealedTicketCover groupLabel={`${groupName} · About you`} stats={stats} mode="static" />
    </main>
  );
}
