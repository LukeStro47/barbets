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

/** The group hub's "N waiting on you" card — alert-bg / alert-line needs-you surface per
 * DESIGN.md, dismissible, one row per task the viewer can act on right now. Reappears when
 * the task set changes, since dismissal is keyed to a signature rather than a plain flag. */
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
    <div className="overflow-hidden rounded-[20px] border border-alert-line bg-alert-bg">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-2.5">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-alert font-mono text-[15px] font-semibold text-white">
          {tasks.length}
        </span>
        <p className="flex-1 text-[13.5px] font-bold text-ink">
          {tasks.length === 1 ? 'One thing needs you' : `${tasks.length} things need you`}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-alert"
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {tasks.map((task, i) => (
        <div
          key={`${task.type}:${task.marketId}`}
          className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? 'border-t border-alert-line' : ''} ${i < tasks.length - 1 ? 'border-b border-alert-line' : ''}`}
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
                ? 'shrink-0 rounded-[14px] bg-ink px-3.5 py-[7px] text-[12.5px] font-bold text-white'
                : 'shrink-0 rounded-[14px] border border-hairline bg-surface px-3.5 py-[6px] text-[12.5px] font-bold text-ink'
            }
          >
            {task.type === 'vote' ? 'Vote' : 'Endorse'}
          </Link>
        </div>
      ))}
    </div>
  );
}
