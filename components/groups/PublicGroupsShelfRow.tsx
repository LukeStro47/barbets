import Link from 'next/link';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { ChevronRightIcon } from '@/components/ui/icons';
import { numberWordCapitalized } from '@/lib/formatNumber';

/** The collapsed shelf for a user who already has at least one group — same weight as the
    "Between seasons" row below it, deliberately: this reads as a quiet shelf, not a pitch, once
    there's a real table to focus on. Full-detail cards only show up in the "Open to anyone"
    section for a zero-group user (see the groups hub page) and on /groups/discover itself. */
export function PublicGroupsShelfRow({
  groups,
  totalOpenMarkets,
}: {
  groups: { name: string; avatarKey: string | null }[];
  totalOpenMarkets: number;
}) {
  return (
    <Link href="/groups/discover" className="flex items-center gap-[11px] rounded-2xl border border-espresso-100 bg-paper-white px-3.5 py-3">
      <span className="flex shrink-0">
        {groups.slice(0, 2).map((g, i) => (
          <GroupAvatar
            key={g.name}
            name={g.name}
            avatarKey={g.avatarKey}
            className={i === 0 ? 'h-[26px] w-[26px] border-2 border-paper-white text-[10px]' : '-ml-[9px] h-[26px] w-[26px] border-2 border-paper-white text-[10px]'}
            fallbackClassName="bg-espresso-50 text-espresso-500"
          />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-extrabold text-espresso-950">Public groups</span>
        <span className="mt-px block text-[11.5px] text-espresso-400">
          {numberWordCapitalized(groups.length)} open to anyone
          {totalOpenMarkets > 0 && ` · ${totalOpenMarkets} ${totalOpenMarkets === 1 ? 'market' : 'markets'} live`}
        </span>
      </span>
      <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-espresso-300" />
    </Link>
  );
}
