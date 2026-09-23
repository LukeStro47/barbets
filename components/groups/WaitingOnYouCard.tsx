'use client';

import Link from 'next/link';
import { ChevronRightIcon } from '@/components/ui/icons';
import { numberWordCapitalized } from '@/lib/formatNumber';
import type { GroupTask } from '@/lib/tasks';

/**
 * Markets hub "needs you" strip — compact alert row per DESIGN.md needs-you-card. Tasks
 * themselves live in Inbox; this is the hub's one-tap shortcut, not a second task list.
 */
export function WaitingOnYouCard({ tasks }: { groupId: string; tasks: GroupTask[] }) {
  if (tasks.length === 0) return null;

  const label =
    tasks.length === 1 ? 'One thing needs you' : `${numberWordCapitalized(tasks.length)} things need you`;

  return (
    <Link
      href="/inbox"
      className="flex items-center gap-3 rounded-[20px] border border-alert-line bg-alert-bg px-4 py-3.5"
    >
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-alert font-mono text-[15px] font-semibold text-white">
        {tasks.length}
      </span>
      <p className="min-w-0 flex-1 text-[14.5px] font-bold text-ink">{label}</p>
      <ChevronRightIcon className="h-3.5 w-2 shrink-0 text-alert" />
    </Link>
  );
}
