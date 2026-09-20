'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import type { GroupTask } from '@/lib/tasks';

function dismissKey(groupId: string) {
  return `barbets-tasks-dismissed-${groupId}`;
}

/** A signature of the current task set — dismissal is stored against this, not a bare flag,
 * so a *new* task (a different set) automatically un-dismisses the card instead of staying
 * hidden forever after the first dismiss. */
function taskSignature(tasks: GroupTask[]): string {
  return tasks
    .map((t) => `${t.type}:${t.marketId}`)
    .sort()
    .join(',');
}

/** The group hub's "N waiting on you" card — red-bordered, dismissible, one row per task the
 * viewer specifically can act on right now (endorse an unsponsored market, vote on a disputed
 * one). Reappears automatically once the task set changes, since dismissal is keyed to a
 * signature of the current tasks rather than a plain seen/unseen flag. */
export function WaitingOnYouCard({ groupId, tasks }: { groupId: string; tasks: GroupTask[] }) {
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDismissedSignature(localStorage.getItem(dismissKey(groupId)));
    setMounted(true);
  }, [groupId]);

  if (tasks.length === 0) return null;
  const signature = taskSignature(tasks);
  // Not yet mounted (still reading localStorage) — render nothing rather than flash the card
  // and immediately hide it once the dismissed state loads in.
  if (!mounted) return null;
  if (dismissedSignature === signature) return null;

  function dismiss() {
    localStorage.setItem(dismissKey(groupId), signature);
    setDismissedSignature(signature);
  }

  return (
    <div className="overflow-hidden rounded-[20px] border-[1.5px] border-alert bg-surface">
      <div className="flex items-center gap-2 bg-alert-bg py-[7px] pr-[10px] pl-4">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-alert" />
        <p className="flex-1 text-xs font-extrabold tracking-[0.06em] text-alert uppercase">
          {tasks.length} waiting on you
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-alert"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {tasks.map((task, i) => (
        <div
          key={`${task.type}:${task.marketId}`}
          className={`flex items-center gap-3 px-4 py-3 ${i < tasks.length - 1 ? 'border-b border-rule' : ''}`}
        >
          <span className="min-w-0 flex-1">
            <p className="text-[14.5px] leading-[1.25] font-bold text-ink">
              {task.type === 'vote' ? 'Vote on' : 'Endorse'} <span className="font-semibold text-muted">{task.marketTitle}</span>
            </p>
            <p className={`mt-0.5 text-xs ${task.type === 'vote' ? 'text-alert' : 'text-faint'}`}>
              <CountdownTimer target={task.deadline} prefix={task.type === 'vote' ? 'Voting closes in' : 'Expires in'} />
            </p>
          </span>
          <Link
            href={`/groups/${groupId}/markets/${task.marketId}`}
            className={
              task.type === 'vote'
                ? 'shrink-0 rounded-full bg-ink px-3.5 py-[7px] text-[12.5px] font-bold text-white'
                : 'shrink-0 rounded-full border-[1.5px] border-hairline px-3.5 py-[6px] text-[12.5px] font-bold text-ink'
            }
          >
            {task.type === 'vote' ? 'Vote' : 'Endorse'}
          </Link>
        </div>
      ))}
    </div>
  );
}
