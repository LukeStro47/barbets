import { Mention } from '@/components/ui/Mention';
import { RosterControl } from '@/components/groups/IntermissionActions';
import { formatTokens } from '@/lib/formatNumber';

function TimelineStep({
  done,
  title,
  subtitle,
  isLast,
}: {
  done: boolean;
  title: React.ReactNode;
  subtitle: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-stretch gap-3">
      <span className="flex w-[18px] shrink-0 flex-col items-center">
        <span className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-signal' : 'border-2 border-hairline bg-surface'}`} />
        {!isLast && <span className="w-[2px] flex-1 bg-rule" />}
      </span>
      <span className={`block leading-[1.35] ${!isLast ? 'pb-3.5' : ''}`}>
        <span className="block text-[13.5px] leading-[1.3] font-bold text-ink">{title}</span>
        <span className="block text-[11.5px] leading-[1.35] text-faint">{subtitle}</span>
      </span>
    </div>
  );
}

/** Member-only: the timeline replacing the owner's Season N+1 setup card, plus the same
 * playing/sitting-out toggle the old intermission page offered. */
export function WhatsNextCard({
  groupId,
  seasonId,
  ownerNickname,
  reseedAmount,
  playingCount,
  sittingOutNicknames,
  membershipStatus,
  hasOptedOut,
  hasOptedIn,
}: {
  groupId: string;
  seasonId: string;
  ownerNickname: string;
  reseedAmount: number | null;
  playingCount: number;
  sittingOutNicknames: string[];
  membershipStatus: 'active' | 'dormant';
  hasOptedOut: boolean;
  hasOptedIn: boolean;
}) {
  const isIn = membershipStatus === 'active' ? !hasOptedOut : hasOptedIn;

  return (
    <div className="flex flex-col gap-3.5 rounded-[24px] border border-hairline bg-surface p-[18px] shadow-sm shadow-none">
      <h2 className="font-display text-[15px] font-bold text-ink">What happens next</h2>
      <div className="flex flex-col">
        <TimelineStep done title="Season closed today" subtitle="Every market settled, balances locked in." />
        <TimelineStep
          done={false}
          title={
            <>
              <Mention nickname={ownerNickname} /> starts the next season
            </>
          }
          subtitle={reseedAmount != null ? `Everyone playing gets reseeded to ${formatTokens(reseedAmount)}.` : 'Everyone playing gets reseeded.'}
        />
        <TimelineStep done={false} title="Betting opens" subtitle="First markets can go up. Nothing to do until then." isLast />
      </div>
      <div className="flex items-center gap-3 border-t border-rule pt-3.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] leading-[1.3] font-bold text-ink">
            {isIn ? "You're opted-in to the next season by default" : "You're sitting this one out"}
          </span>
          <span className="block text-[11.5px] leading-[1.35] text-faint">
            {playingCount} in{sittingOutNicknames.length > 0 && `, ${sittingOutNicknames.map((n) => `@${n}`).join(', ')} sitting out`}
          </span>
        </span>
      </div>
      <RosterControl
        groupId={groupId}
        seasonId={seasonId}
        membershipStatus={membershipStatus}
        hasOptedOut={hasOptedOut}
        hasOptedIn={hasOptedIn}
      />
    </div>
  );
}
