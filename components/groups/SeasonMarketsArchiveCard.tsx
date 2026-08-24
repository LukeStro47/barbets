import Link from 'next/link';
import { TicketIcon, CalendarIcon, ChevronRightIcon } from '@/components/ui/icons';

/**
 * Between seasons every market is settled, so the Open/Pending/Settled feed collapses to these
 * two rows — the archive becomes something you open, not something you scroll. Both link into
 * /seasons, the season-scoped drill-down.
 */
export function SeasonMarketsArchiveCard({
  groupId,
  seasonNumber,
  marketsSettled,
  viewerBetCount,
  hasEarlierSeasons,
}: {
  groupId: string;
  seasonNumber: number;
  marketsSettled: number;
  /** How many of this season's settled markets the viewer had a bet on — omitted if unknown. */
  viewerBetCount?: number;
  hasEarlierSeasons: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-xs font-bold tracking-[0.08em] text-espresso-400 uppercase">The season&apos;s markets</h2>
      <div className="overflow-hidden rounded-[22px] border border-espresso-100 bg-paper-white">
        <Link
          href={`/groups/${groupId}/seasons?season=${seasonNumber}`}
          className="flex items-center gap-3 border-b border-espresso-50 px-4 py-[14px] transition-colors hover:bg-espresso-50/25"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-espresso-50 text-espresso-600">
            <TicketIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <p className="font-display text-[15px] leading-[1.25] font-bold text-espresso-950">
              All {marketsSettled} from this season
            </p>
            <p className="mt-0.5 text-xs leading-[1.35] text-espresso-400">
              Settled and paid out.{viewerBetCount != null && ` You were on ${viewerBetCount} of them.`}
            </p>
          </span>
          <ChevronRightIcon className="h-[13px] w-[7px] shrink-0 text-espresso-200" />
        </Link>
        {hasEarlierSeasons && (
          <Link
            href={`/groups/${groupId}/seasons`}
            className="flex items-center gap-3 px-4 py-[14px] transition-colors hover:bg-espresso-50/25"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-espresso-50 text-espresso-600">
              <CalendarIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <p className="font-display text-[15px] leading-[1.25] font-bold text-espresso-950">Earlier seasons</p>
              <p className="mt-0.5 text-xs leading-[1.35] text-espresso-400">See how past seasons played out</p>
            </span>
            <ChevronRightIcon className="h-[13px] w-[7px] shrink-0 text-espresso-200" />
          </Link>
        )}
      </div>
      <p className="px-1 text-[11.5px] leading-[1.4] text-espresso-400">
        Nothing is open or pending, so the three tabs collapse into {hasEarlierSeasons ? 'these two rows' : 'this row'} until the next season
        starts.
      </p>
    </div>
  );
}
