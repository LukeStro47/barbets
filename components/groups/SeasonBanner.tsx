import Link from 'next/link';

export interface SeasonBannerData {
  number: number;
  status: 'active' | 'intermission' | 'archived';
  endsAt?: string | null;
}

/** Intermission only — the active-season "Season N · ends in Xd" line now renders inline in the group hub's title block instead of a separate banner. */
export function SeasonBanner({ groupId, season }: { groupId: string; season: SeasonBannerData }) {
  if (season.status !== 'intermission') return null;

  return (
    <Link href={`/groups/${groupId}/intermission`}>
      <div className="rounded-2xl bg-honey-500 px-5 py-3 text-center font-semibold text-espresso-900 transition-opacity hover:opacity-90">
        Season {season.number - 1} is over. Run it back? →
      </div>
    </Link>
  );
}
