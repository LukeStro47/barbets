import Link from 'next/link';
import { RowChevron } from '@/components/ui/Screen';

/** 4q's quiet shelf for someone who already has a group: a globe tile, "Open to anyone", "Join
 *  instantly, no invite needed", into /groups/discover. The live-market count rides on the end
 *  of the subtitle when there is one. Full cards only appear for a zero-group user (5h). */
export function PublicGroupsShelfRow({ totalOpenMarkets }: { groups?: { name: string; avatarKey: string | null }[]; totalOpenMarkets: number }) {
  return (
    <Link href="/groups/discover" className="flex items-center gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-3.5">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-signal-tint text-signal">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.4 2.6 2.4 14.4 0 17M12 3.5c-2.4 2.6-2.4 14.4 0 17" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold text-ink">Open to anyone</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-faint">
          Join instantly, no invite needed{totalOpenMarkets > 0 ? ` · ${totalOpenMarkets} open` : ''}
        </span>
      </span>
      <RowChevron className="text-faint" />
    </Link>
  );
}
