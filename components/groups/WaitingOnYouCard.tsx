import Link from 'next/link';
import type { GroupTask } from '@/lib/tasks';

/**
 * The group hub's "N things need you" summary (4a) — a compact alert-tinted row rather than the
 * per-task list this used to render inline (each task's own endorse/vote action already lives
 * on its own card in the Pending tab below, and now also on /inbox's "Needs you" section, so
 * repeating full task detail a third time here added length without adding a new way to act).
 * Links straight to /inbox, the cross-group version of the same list, rather than staying
 * dismissible — there's nothing left to dismiss once it's just a count.
 */
export function WaitingOnYouCard({ tasks }: { tasks: GroupTask[] }) {
  if (tasks.length === 0) return null;

  return (
    <Link
      href="/inbox"
      className="flex items-center gap-[10px] rounded-[14px] border border-alert-line bg-alert-bg px-[13px] py-[9px]"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-alert font-mono text-[11px] font-semibold text-surface">
        {tasks.length}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] font-bold text-ink">
        {tasks.length === 1 ? 'One thing needs you' : `${tasks.length} things need you`}
      </span>
      <svg width="6" height="11" viewBox="0 0 8 14" fill="none" className="shrink-0">
        <path d="M1 1l6 6-6 6" stroke="#c8392c" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </Link>
  );
}
