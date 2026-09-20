import { createClient, requireUser } from '@/lib/supabase/server';
import { getGroupTasks, type GroupTask } from '@/lib/tasks';
import { ScreenScroller } from '@/components/ui/Shell';
import Link from 'next/link';

export default async function InboxPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name, avatar_key')
    .order('created_at', { ascending: false });

  const groups = groupRows ?? [];
  const tasksByGroup: { groupId: string; groupName: string; tasks: GroupTask[] }[] = [];

  for (const g of groups) {
    const { tasks } = await getGroupTasks(supabase, g.id, user.id);
    if (tasks.length > 0) {
      tasksByGroup.push({ groupId: g.id, groupName: g.name, tasks });
    }
  }

  const total = tasksByGroup.reduce((n, g) => n + g.tasks.length, 0);

  // Group rows by a coarse day label for the design's day sections.
  const rows: {
    day: string;
    groupId: string;
    groupName: string;
    task: GroupTask;
  }[] = [];
  for (const g of tasksByGroup) {
    for (const task of g.tasks) {
      const day = dayLabel(task.deadline);
      rows.push({ day, groupId: g.groupId, groupName: g.groupName, task });
    }
  }

  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-[430px]">
        <div className="border-b border-hairline bg-surface px-[22px] pt-4 pb-3">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em] text-ink">Inbox</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {total === 0
              ? 'Nothing needs you right now.'
              : total === 1
                ? 'One thing needs you.'
                : `${total} things need you.`}
          </p>
        </div>

        <ScreenScroller tight className="space-y-[22px] py-5">
          {total === 0 ? (
            <div className="rounded-[20px] border border-hairline bg-surface px-4 py-8 text-center">
              <p className="text-[14.5px] font-bold text-ink">All clear</p>
              <p className="mt-1 text-[12.5px] text-muted">
                Endorsements and challenge votes will show up here when a market is waiting on you.
              </p>
            </div>
          ) : (
            [...byDay.entries()].map(([day, dayRows]) => (
              <section key={day} className="space-y-[9px]">
                <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">{day}</p>
                <ul className="space-y-[9px]">
                  {dayRows.map(({ groupId, groupName, task }) => (
                    <li key={`${groupId}-${task.marketId}-${task.type}`}>
                      <Link
                        href={`/groups/${groupId}/markets/${task.marketId}`}
                        className="flex items-center gap-3 rounded-[20px] border border-hairline bg-surface px-4 py-[14px]"
                      >
                        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-alert-bg text-[13px] font-bold text-alert">
                          {task.type === 'endorse' ? 'E' : 'V'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-bold text-ink">{task.marketTitle}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-faint">
                            {groupName} · {task.type === 'endorse' ? 'Needs an endorsement' : 'Needs your vote'}
                          </span>
                        </span>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-alert" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </ScreenScroller>
      </div>
    </div>
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startThat.getTime() - startToday.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
