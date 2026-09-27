import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { getGroupTasks, type GroupTask } from '@/lib/tasks';
import { getGroupBarSwitcherState } from '@/lib/groupBar';
import { GroupBar } from '@/components/layout/GroupBar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RowChevron } from '@/components/ui/Screen';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { formatSignedTokens, formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

/**
 * 4j: everything waiting on you across your groups, then the news. Built entirely from data the
 * viewer can already read under existing RLS — never a replay of notification_events, which has
 * no client read path (see ARCHITECTURE.md):
 *   - Needs you: getGroupTasks() across every group (endorse / vote), naming who's asking.
 *   - Paid out / settled: the viewer's own settled bets from the last 14 days.
 *   - Mentions: comments in visible markets whose body carries "@yournickname" in that group.
 *   - Closes soon: open markets the viewer holds a bet on, closing within a day.
 * Opened from inside a group (?group=), the group bar sits on top as it does on every other tab.
 */

type Row =
  | { kind: 'paid'; key: string; href: string; title: string; net: number; at: string; outcome: 'won' | 'lost' | 'voided' }
  | { kind: 'mention'; key: string; href: string; who: string; quote: string; at: string }
  | { kind: 'closing'; key: string; href: string; title: string; closesAt: string; stake: number; at: string };

function dayBucket(iso: string, now: Date): string {
  const d = new Date(iso);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (same(d, now) || d > now) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupParam } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name, avatar_key, memberships!inner(user_id, status, nickname)')
    .eq('memberships.user_id', user.id)
    .in('memberships.status', ['active', 'dormant']);
  const groups = (groupRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    avatarKey: g.avatar_key,
    myNickname: ((g.memberships ?? []) as { nickname: string | null }[])[0]?.nickname ?? null,
  }));
  const barGroup = groups.find((g) => g.id === groupParam) ?? null;
  const since = new Date(Date.now() - 14 * 24 * 3_600_000).toISOString();
  const soon = new Date(Date.now() + 24 * 3_600_000).toISOString();

  const perGroup = await Promise.all(
    groups.map(async (g) => {
      const [{ tasks }, { data: settled }, { data: mentions }, { data: openBets }] = await Promise.all([
        getGroupTasks(supabase, g.id, user.id),
        supabase
          .from('bets')
          .select('amount, payout, markets!inner(id, title, group_id, status, resolved_at)')
          .eq('user_id', user.id)
          .eq('markets.group_id', g.id)
          .in('markets.status', ['resolved', 'voided'])
          .gte('markets.resolved_at', since),
        g.myNickname
          ? supabase
              .from('market_comments')
              .select('id, user_id, body, created_at, market_id, markets!inner(group_id)')
              .eq('markets.group_id', g.id)
              .neq('user_id', user.id)
              .is('deleted_at', null)
              .ilike('body', `%@${g.myNickname}%`)
              .gte('created_at', since)
              .order('created_at', { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [] }),
        supabase
          .from('bets')
          .select('amount, markets!inner(id, title, group_id, status, closes_at)')
          .eq('user_id', user.id)
          .eq('markets.group_id', g.id)
          .eq('markets.status', 'open')
          .lte('markets.closes_at', soon),
      ]);
      return { g, tasks, settled: settled ?? [], mentions: (mentions ?? []) as { id: string; user_id: string; body: string; created_at: string; market_id: string }[], openBets: openBets ?? [] };
    })
  );

  // ── Who's asking, for the Needs-you cards: the creator of a market to endorse, the challenger
  //    of a disputed one (plus the viewer's own stake there).
  const tasks = perGroup.flatMap(({ g, tasks }) => tasks.map((t) => ({ ...t, group: g })));
  const endorseIds = tasks.filter((t) => t.type === 'endorse').map((t) => t.marketId);
  const voteIds = tasks.filter((t) => t.type === 'vote').map((t) => t.marketId);
  const [{ data: creators }, { data: challenges }, { data: myDisputedBets }] = await Promise.all([
    endorseIds.length ? supabase.from('markets').select('id, creator_id').in('id', endorseIds) : Promise.resolve({ data: [] }),
    voteIds.length ? supabase.from('challenges').select('market_id, challenger_id').in('market_id', voteIds) : Promise.resolve({ data: [] }),
    voteIds.length ? supabase.from('bets').select('market_id, amount').eq('user_id', user.id).in('market_id', voteIds) : Promise.resolve({ data: [] }),
  ]);
  const actorByMarket = new Map<string, string>();
  for (const c of creators ?? []) if (c.creator_id) actorByMarket.set(c.id, c.creator_id);
  for (const c of challenges ?? []) actorByMarket.set(c.market_id, c.challenger_id);
  const stakeByMarket = new Map<string, number>();
  for (const b of myDisputedBets ?? []) stakeByMarket.set(b.market_id, (stakeByMarket.get(b.market_id) ?? 0) + b.amount);

  const peopleIds = [...new Set([...actorByMarket.values(), ...perGroup.flatMap((p) => p.mentions.map((m) => m.user_id))])];
  const [{ data: people }, { data: peopleUsers }] = peopleIds.length
    ? await Promise.all([
        supabase.from('memberships').select('user_id, group_id, nickname').in('user_id', peopleIds).in('group_id', groups.map((g) => g.id)),
        supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', peopleIds),
      ])
    : [{ data: [] }, { data: [] }];
  const nicknameIn = (groupId: string, userId: string) => (people ?? []).find((p) => p.group_id === groupId && p.user_id === userId)?.nickname ?? '?';
  const avatarOf = new Map((peopleUsers ?? []).map((u) => [u.id, u]));

  const needsYou = tasks.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  // ── The feed ──
  const rows: Row[] = [];
  for (const { g, settled, mentions, openBets } of perGroup) {
    const byMarket = new Map<string, { title: string; status: string; at: string; amount: number; payout: number }>();
    for (const r of settled) {
      const m = r.markets as unknown as { id: string; title: string; status: string; resolved_at: string };
      const e = byMarket.get(m.id) ?? { title: m.title, status: m.status, at: m.resolved_at, amount: 0, payout: 0 };
      e.amount += r.amount;
      e.payout += r.payout ?? 0;
      byMarket.set(m.id, e);
    }
    for (const [id, e] of byMarket) {
      rows.push({
        kind: 'paid',
        key: `paid:${id}`,
        href: `/groups/${g.id}/markets/${id}/reveal`,
        title: e.title,
        net: e.payout - e.amount,
        at: e.at,
        outcome: e.status === 'voided' ? 'voided' : e.payout > 0 ? 'won' : 'lost',
      });
    }
    for (const m of mentions) {
      rows.push({
        kind: 'mention',
        key: `mention:${m.id}`,
        href: `/groups/${g.id}/markets/${m.market_id}?tab=comments`,
        who: nicknameIn(g.id, m.user_id),
        quote: m.body,
        at: m.created_at,
      });
    }
    const closing = new Map<string, { title: string; closesAt: string; stake: number }>();
    for (const b of openBets) {
      const m = b.markets as unknown as { id: string; title: string; closes_at: string };
      const e = closing.get(m.id) ?? { title: m.title, closesAt: m.closes_at, stake: 0 };
      e.stake += b.amount;
      closing.set(m.id, e);
    }
    for (const [id, e] of closing) {
      rows.push({ kind: 'closing', key: `closing:${id}`, href: `/groups/${g.id}/markets/${id}`, title: e.title, closesAt: e.closesAt, stake: e.stake, at: new Date().toISOString() });
    }
  }
  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const now = new Date();
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const bucket = dayBucket(r.at, now);
    byDay.set(bucket, [...(byDay.get(bucket) ?? []), r]);
  }

  const n = needsYou.length;
  const subtitle = n === 0 ? 'Nothing needs you. The rest is just news.' : n === 1 ? 'One thing needs you. The rest is just news.' : `${n} things need you. The rest is just news.`;
  const switcherState = barGroup ? await getGroupBarSwitcherState(supabase, barGroup.id, user.id) : null;

  return (
    <>
      {barGroup && switcherState && <GroupBar groupName={barGroup.name} avatarKey={barGroup.avatarKey} {...switcherState} />}
      <main className="mx-auto max-w-[430px] px-[18px] pt-5 pb-10">
        <h1 className="text-[25px] font-extrabold tracking-[-0.022em] text-ink">Inbox</h1>
        <p className="mt-1.5 text-[13px] text-faint">{subtitle}</p>

        {n > 0 && (
          <>
            <p className="mt-5 text-[10.5px] font-bold tracking-[0.1em] text-alert uppercase">Needs you</p>
            <div className="mt-[9px] flex flex-col gap-2.5">
              {needsYou.map((t) => (
                <NeedsYouCard
                  key={`${t.group.id}:${t.marketId}:${t.type}`}
                  task={t}
                  groupId={t.group.id}
                  groupName={groups.length > 1 && t.group.id !== barGroup?.id ? t.group.name : null}
                  actorId={actorByMarket.get(t.marketId) ?? null}
                  actorNickname={actorByMarket.has(t.marketId) ? nicknameIn(t.group.id, actorByMarket.get(t.marketId)!) : null}
                  avatar={actorByMarket.has(t.marketId) ? avatarOf.get(actorByMarket.get(t.marketId)!) : undefined}
                  stake={stakeByMarket.get(t.marketId) ?? 0}
                />
              ))}
            </div>
          </>
        )}

        {[...byDay.entries()].map(([bucket, list]) => (
          <section key={bucket}>
            <p className="mt-[22px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">{bucket}</p>
            <div className="mt-[9px] overflow-hidden rounded-[18px] border border-hairline bg-surface">
              {list.map((r) => (
                <Link key={r.key} href={r.href} className="flex items-center gap-[11px] border-b border-row-rule px-4 py-[13px] last:border-b-0">
                  <FeedIcon row={r} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-ink">
                      {r.kind === 'paid'
                        ? r.outcome === 'won'
                          ? `${r.title} paid out`
                          : r.outcome === 'voided'
                            ? `${r.title} was voided`
                            : `${r.title} didn't go your way`
                        : r.kind === 'mention'
                          ? `@${r.who} mentioned you`
                          : `${r.title} closes soon`}
                    </span>
                    <span className="mt-px block truncate font-mono text-[11.5px] text-faint">
                      {r.kind === 'paid' ? (
                        `${r.outcome === 'voided' ? 'Refunded' : formatSignedTokens(r.net)} · ${formatRelativeTime(r.at)}`
                      ) : r.kind === 'mention' ? (
                        `"${r.quote}" · ${formatRelativeTime(r.at)}`
                      ) : (
                        <>
                          <CountdownTimer target={r.closesAt} prefix="" /> left to add to your {formatTokens(r.stake)}
                        </>
                      )}
                    </span>
                  </span>
                  <RowChevron className="text-faint" />
                </Link>
              ))}
            </div>
          </section>
        ))}

        {n === 0 && rows.length === 0 && (
          <div className="mt-6 rounded-[20px] border border-dashed border-dash bg-surface px-6 py-10 text-center">
            <p className="text-[13px] leading-[1.5] text-faint">Nothing here yet. Endorsements, votes, mentions and results across your groups show up here.</p>
          </div>
        )}
      </main>
    </>
  );
}

function NeedsYouCard({
  task,
  groupId,
  groupName,
  actorId,
  actorNickname,
  avatar,
  stake,
}: {
  task: GroupTask;
  groupId: string;
  groupName: string | null;
  actorId: string | null;
  actorNickname: string | null;
  avatar?: { avatar_updated_at: string | null; avatar_preset_key: string | null };
  stake: number;
}) {
  const endorse = task.type === 'endorse';
  return (
    <Link href={`/groups/${groupId}/markets/${task.marketId}`} className="block overflow-hidden rounded-[18px] border border-alert-line bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
      <div className="flex items-start gap-[11px] px-4 pt-3.5 pb-3">
        {actorId && actorNickname ? (
          <UserAvatar
            userId={actorId}
            nickname={actorNickname}
            avatarUpdatedAt={avatar?.avatar_updated_at}
            avatarPresetKey={avatar?.avatar_preset_key}
            className="h-[30px] w-[30px] text-[11px]"
            fallbackClassName="bg-tile text-muted"
          />
        ) : (
          <span className="h-[30px] w-[30px] shrink-0 rounded-full bg-tile" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold tracking-[0.08em] text-alert uppercase">
            {endorse ? 'Endorsement' : 'Disputed result'}
            {groupName && <span className="font-semibold text-faint normal-case tracking-normal"> · {groupName}</span>}
          </span>
          <span className="mt-[3px] block text-[14.5px] leading-[1.35] font-bold text-ink text-pretty">
            {endorse
              ? `${actorNickname ? `@${actorNickname}` : 'Someone'} wants to open "${task.marketTitle}"`
              : `${actorNickname ? `@${actorNickname}` : 'Someone'} says the result of "${task.marketTitle}" was wrong.${stake > 0 ? ` You bet ${formatTokens(stake)}.` : ''}`}
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2.5 border-t border-alert-line bg-alert-bg px-4 py-2.5">
        <span className="text-[12px] font-bold text-alert">
          {endorse ? (
            'Endorse'
          ) : (
            <>
              Have your say · <CountdownTimer target={task.deadline} prefix="" /> left
            </>
          )}
        </span>
        <RowChevron className="text-alert" />
      </div>
    </Link>
  );
}

function FeedIcon({ row }: { row: Row }) {
  if (row.kind === 'paid' && row.outcome === 'won') {
    return (
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-gain-bg text-gain">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 8.5 5 5l2 2 3-4" />
        </svg>
      </span>
    );
  }
  if (row.kind === 'mention') {
    return (
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-signal-tint text-signal">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M16 8v5a3 3 0 0 0 4.5 2.6A9 9 0 1 0 17 20" />
        </svg>
      </span>
    );
  }
  return (
    <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-tile text-muted')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5l3 2" />
      </svg>
    </span>
  );
}
