import { ScreenHeader } from '@/components/ui/Screen';
import { StatusChip, MarketTitleBlock, NextStepsCard, type NextStep } from '@/components/markets/MarketScreen';
import { PoolStrip } from '@/components/markets/PoolStrip';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { SealedTicketCover } from '@/components/markets/SealedTicketCover';
import type { MarketStatus } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';

export interface SubjectMarketPulseData {
  status: MarketStatus;
  market_type: 'yes_no' | 'over_under' | 'multiple_choice';
  closes_at: string;
  bet_count: number;
  pool_amount: number;
}

/** What a subject sees instead of the real market page. Assembled from the same pieces as every
 * other market state (title block, PoolStrip, the one ticket, What happens next) so it reads as
 * the same screen with the content withheld, not a separate world. get_subject_market_pulse
 * deliberately hands back nothing that could identify what the market is about (no title, no
 * description, no other members involved, no odds): just the coarse shape of the action (bet
 * count, total staked, time to close). The ticket really does tear open the moment the market
 * resolves; see RevealTicket's `sealedForSubject` prop for that half of the story.
 *
 * Status is folded to Open/Closed on purpose: called and challenged are both "closed" from where
 * the subject stands, and saying which would leak that someone has called it. */
export function SubjectMarketPulse({
  groupId,
  groupName,
  pulse,
}: {
  groupId: string;
  groupName: string;
  pulse: SubjectMarketPulseData;
}) {
  const isOpen = pulse.status === 'open';

  const cells: React.ComponentProps<typeof PoolStrip>['cells'] = [
    { label: 'Staked', value: formatTokens(pulse.pool_amount) },
    { label: 'Bets', value: pulse.bet_count, flex: 0.8 },
  ];
  if (isOpen) cells.push({ label: 'Closes in', value: <CountdownTimer target={pulse.closes_at} prefix="" />, tone: 'signal', flex: 1.2 });

  const revealStep: NextStep = { title: 'It opens for you', sub: 'The question, the result, and who bet what.', state: 'upcoming' };
  const steps: NextStep[] = isOpen
    ? [
        {
          title: 'Betting closes',
          sub: (
            <>
              In <CountdownTimer target={pulse.closes_at} prefix="" />. You can&apos;t bet on a market about you.
            </>
          ),
          state: 'current',
        },
        { title: 'The group settles it', sub: 'Someone calls the result, and anyone can challenge it.', state: 'upcoming' },
        revealStep,
      ]
    : [
        { title: 'Betting closed', sub: 'Nobody can add to the pool now.', state: 'done' },
        { title: 'The group settles it', sub: 'Someone calls the result, and anyone can challenge it.', state: 'current' },
        revealStep,
      ];

  return (
    <>
      <ScreenHeader
        title={groupName}
        tone="context"
        href={`/groups/${groupId}`}
        right={<StatusChip label={isOpen ? 'Open' : 'Closed'} tone={isOpen ? 'quiet' : 'ink'} />}
      />
      <main className="mx-auto flex max-w-[430px] flex-col gap-[11px] px-[18px] pt-[13px] pb-10">
        <MarketTitleBlock title="A market about you" subtitle="Sealed until it resolves" />
        <PoolStrip className="mt-[3px]" cells={cells} />
        <SealedTicketCover groupLabel={`${groupName} · About you`} mode="static" />
        <NextStepsCard steps={steps} />
      </main>
    </>
  );
}
