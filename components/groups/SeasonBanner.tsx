import Link from 'next/link';

export interface SeasonBannerData {
  number: number;
  status: 'active' | 'winding_down' | 'intermission' | 'archived';
  endsAt?: string | null;
  name?: string | null;
}

/** Intermission links to the roster/continue screen; winding_down is informational only (there's no intermission row to link to yet). The active-season "Season N · ends in Xd" line renders inline in the group hub's title block instead of a separate banner. */
export function SeasonBanner({ groupId, season }: { groupId: string; season: SeasonBannerData }) {
  if (season.status === 'winding_down') {
    return (
      <div className="rounded-2xl border border-espresso-200 bg-espresso-50 px-5 py-3 text-center font-semibold text-espresso-700">
        {season.name ?? `Season ${season.number}`} is wrapping up, still resolving a few markets.
      </div>
    );
  }

  if (season.status !== 'intermission') return null;

  return (
    <Link href={`/groups/${groupId}/intermission`}>
      <div className="rounded-2xl bg-honey-500 px-5 py-3 text-center font-semibold text-espresso-900 transition-opacity hover:opacity-90">
        Season {season.number - 1} is over. Run it back? →
      </div>
    </Link>
  );
}
