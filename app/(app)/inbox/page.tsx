import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { getGroupTasks, type GroupTask } from '@/lib/tasks';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { formatSignedTokens } from '@/lib/formatNumber';
import { ChevronRightIcon, CheckIcon, AtSignIcon, ClockIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * The cross-group Inbox reintroduced per the Ledger redesign (4j) — deliberately removed in
 * commit c9861e6 in favor of per-group task cards (see lib/tasks.ts's own doc comment). This
 * brings back one real, day-grouped feed rather than the old page, built entirely from data the
 * viewer already has RLS-safe access to:
 *   - "Needs you": the same getGroupTasks() every group hub's "waiting on you" card already
 *     uses, just flattened across every group instead of one at a time.
 *   - "Recent": the viewer's own settled bets (bets_select is already own-rows-only, so this
 *     reads nothing a hidden-subject or privacy rule would object to) from the trailing 14 days.
 * Deliberately NOT a replay of notification_events (service_role-only, no client read path
 * exists today, and building one blind — without a chance to verify against a real database —
 * risked reopening exactly the kind of privacy leak is_market_visible() exists to prevent). A
 * fuller feed (mentions, admin broadcasts) is real follow-up work once that read path can be
 * built and verified properly, not shipped as a guess.
 */

interface NeedsYouRow extends GroupTask {
  groupId: string;
  groupName: string;
}

interface RecentRow {
  key: string;
  groupId: string;
  groupName: string;
  marketId: string;
  marketTitle: string;
  amount: number;
  payout: number | null;
  outcome: 'won' | 'lost' | 'voided';
  at: string;
}

function dayBucket(iso: string, now: Date): string {
  const d = new Date(iso);
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, now)) return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default async function InboxPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name, memberships!inner(user_id, status)')
    .eq('memberships.user_id', user.id)
    .in('memberships.status', ['active', 'dormant']);
  const groups = (groupRows ?? []).map((g) => ({ id: g.id, name: g.name }));

  const [needsYouByGroup, recentByGroup] = await Promise.all([
    Promise.all(groups.map((g) => getGroupTasks(supabase, g.id, user.id).then((r) => ({ group: g, tasks: r.tasks })))),
    Promise.all(
      groups.map(async (g) => {
        const since = new Date(Date.now() - 14 * 24 * 3_600_000).toISOString();
        const { data } = await supabase
          .from('bets')
          .select('market_id, amount, payout, markets!inner(id, title, group_id, status, resolved_at)')
          .eq('user_id', user.id)
          .eq('markets.group_id', g.id)
          .in('markets.status', ['resolved', 'voided'])
          .gte('markets.resolved_at', since)
          .order('resolved_at', { foreignTable: 'markets', ascending: false });
        return { group: g, rows: data ?? [] };
      })
    ),
  ]);

  const needsYou: NeedsYouRow[] = needsYouByGroup
    .flatMap(({ group, tasks }) => tasks.map((t) => ({ ...t, groupId: group.id, groupName: group.name })))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  const recent: RecentRow[] = recentByGroup
    .flatMap(({ group, rows }) =>
      rows.map((r) => {
        const market = r.markets as unknown as { id: string; title: string; status: string; resolved_at: string };
        const outcome: RecentRow['outcome'] = market.status === 'voided' ? 'voided' : (r.payout ?? 0) > 0 ? 'won' : 'lost';
        return {
          key: `${group.id}:${r.market_id}`,
          groupId: group.id,
          groupName: group.name,
          marketId: market.id,
          marketTitle: market.title,
          amount: r.amount,
          payout: r.payout,
          outcome,
          at: market.resolved_at,
        };
      })
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const now = new Date();
  const recentByDay = new Map<string, RecentRow[]>();
  for (const row of recent) {
    const bucket = dayBucket(row.at, now);
    if (!recentByDay.has(bucket)) recentByDay.set(bucket, []);
    recentByDay.get(bucket)!.push(row);
  }

  const needsCount = needsYou.length;
  const subtitle =
    needsCount === 0
      ? "Nothing needs you right now. The rest is just what's happened lately."
      : needsCount === 1
        ? 'One thing needs you. The rest is just news.'
        : `${needsCount} things need you. The rest is just news.`;

  return (
    <div className="space-y-5 px-4 pt-2 pb-6">
      <PageHeader title="Inbox" subtitle={subtitle} />

      {needsYou.length > 0 && (
        <section className="space-y-2">
          <p className="px-1 text-[10.5px] font-bold tracking-[0.1em] text-alert uppercase">Needs you</p>
          <div className="flex flex-col gap-2.5">
            {needsYou.map((t) => (
              <Link
                key={`${t.groupId}:${t.marketId}:${t.type}`}
                href={`/groups/${t.groupId}/markets/${t.marketId}`}
                className="block overflow-hidden rounded-[18px] border border-alert-line bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]"
              >
                <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold tracking-[0.08em] text-alert uppercase">
                      {t.type === 'endorse' ? 'Endorsement' : 'Disputed result'}
                    </span>
                    <span className="mt-0.5 block text-[14.5px] leading-[1.35] font-bold text-ink text-pretty">
                      {t.marketTitle} in {t.groupName}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2.5 border-t border-alert-line bg-alert-bg px-4 py-2.5">
                  <span className="text-[12px] font-bold text-alert">{t.type === 'endorse' ? 'Endorse' : 'Have your say'}</span>
                  <ChevronRightIcon className="h-3 w-1.5 shrink-0 text-alert" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {[...recentByDay.entries()].map(([bucket, rows]) => (
        <section key={bucket} className="space-y-2">
          <p className="px-1 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">{bucket}</p>
          <div className="overflow-hidden rounded-[18px] border border-hairline bg-surface">
            {rows.map((r, i) => (
              <Link
                key={r.key}
                href={`/groups/${r.groupId}/markets/${r.marketId}/reveal`}
                className={cn('flex items-center gap-2.5 px-4 py-3', i < rows.length - 1 && 'border-b border-rule')}
              >
                <span
                  className={cn(
                    'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px]',
                    r.outcome === 'won' ? 'bg-gain-bg' : r.outcome === 'voided' ? 'bg-rule' : 'bg-rule'
                  )}
                >
                  {r.outcome === 'won' ? <CheckIcon className="h-3.5 w-3.5 text-gain" /> : <ClockIcon className="h-3.5 w-3.5 text-muted" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-ink">
                    {r.outcome === 'won'
                      ? `${r.marketTitle}, you won`
                      : r.outcome === 'voided'
                        ? `${r.marketTitle} was voided`
                        : `${r.marketTitle} resolved`}
                  </span>
                  <span className="mt-px block font-mono text-[11.5px] text-faint">
                    {r.outcome === 'won' && r.payout != null
                      ? `${formatSignedTokens(r.payout - r.amount)} `
                      : r.outcome === 'voided'
                        ? 'Refunded '
                        : ''}
                    {formatRelativeTime(r.at)}
                  </span>
                </span>
                <ChevronRightIcon className="h-3 w-1.5 shrink-0 text-faint" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      {needsYou.length === 0 && recent.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[20px] border border-hairline bg-surface px-6 py-10 text-center">
          <AtSignIcon className="h-5 w-5 text-faint" />
          <p className="text-[13px] text-faint">Nothing here yet. Endorsements, votes, and recent results across your groups will show up here.</p>
        </div>
      )}
    </div>
  );
}
