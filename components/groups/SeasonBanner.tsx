import Link from 'next/link';
import { CountdownTimer } from '@/components/ui/CountdownTimer';

export interface SeasonBannerData {
  number: number;
  status: 'active' | 'intermission' | 'archived';
  endsAt?: string | null;
}

export function SeasonBanner({ groupId, season }: { groupId: string; season: SeasonBannerData }) {
  if (season.status === 'intermission') {
    return (
      <Link href={`/groups/${groupId}/intermission`}>
        <div className="rounded-2xl bg-honey-500 px-5 py-3 text-center font-semibold text-espresso-900 transition-opacity hover:opacity-90">
          Season {season.number - 1} is over. Run it back? →
        </div>
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-2xl bg-espresso-50 px-5 py-3 text-sm font-medium text-espresso-600">
      <span>Season {season.number}</span>
      {season.endsAt && <CountdownTimer target={season.endsAt} prefix="ends in" />}
    </div>
  );
}
