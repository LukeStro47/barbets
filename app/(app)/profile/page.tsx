import Link from 'next/link';
import { cookies } from 'next/headers';
import { createClient, requireUser } from '@/lib/supabase/server';
import { signOut } from '@/lib/actions/auth';
import { getGroupBarSwitcherState } from '@/lib/groupBar';
import { GroupBar } from '@/components/layout/GroupBar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RowChevron, StatCell } from '@/components/ui/Screen';
import { formatSignedTokens, formatTokens } from '@/lib/formatNumber';
import { sideTitle } from '@/components/markets/MarketScreen';
import { LAST_GROUP_COOKIE } from '@/lib/navRoute';

interface OpenBetRow {
  id: string;
  side: string | null;
  option_id: string | null;
  amount: number;
  market_id: string;
  markets: { title: string; status: string; closes_at: string; line: number | null } | null;
}

/**
 * 4k: You. Who you are here (avatar, handle, how long you've played), then, for the group you're
 * in, your record there and the bets you still have riding on it, then one list of settings and
 * the small print. Deliberately no cross-group lifetime stats — each group is its own world, so a
 * number with no group attached is meaningless (a confirmed product call). Everything group-shaped
 * on this page is scoped to one group, named in the bar on top.
 *
 * Which group: `?group=` when the nav passes it, otherwise the last group you were in (a cookie
 * BottomNav writes), otherwise your earliest group. It used to rely on `?group=` alone, which the
 * nav only knew after an in-app visit to a group, so the group bar came and went.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupParam } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const lastGroup = (await cookies()).get(LAST_GROUP_COOKIE)?.value;

  const [{ data: isAdmin }, { data: memberships }, { data: avatarRow }] = await Promise.all([
    supabase.rpc('is_platform_admin'),
    supabase
      .from('memberships')
      .select('id, group_id, nickname, joined_at, status, groups(name, avatar_key)')
      .eq('user_id', user.id)
      .in('status', ['active', 'dormant'])
      .order('joined_at', { ascending: true }),
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', user.id).single(),
  ]);

  const rows = memberships ?? [];
  const current = rows.find((m) => m.group_id === groupParam) ?? rows.find((m) => m.group_id === lastGroup) ?? rows[0] ?? null;
  const handle = current?.nickname ?? user.email?.split('@')[0] ?? 'you';
  const since = rows[0] ? new Date(rows[0].joined_at).toLocaleDateString('en-GB', { month: 'long' }) : null;
  const tenure =
    rows.length === 0
      ? 'Not in a group yet'
      : `Playing ${rows.length} group${rows.length === 1 ? '' : 's'}${since ? ` since ${since}` : ''}`;

  const currentGroup = current?.groups as unknown as { name: string; avatar_key: string | null } | null | undefined;

  const [switcherState, statsResult, betsResult] = current
    ? await Promise.all([
        getGroupBarSwitcherState(supabase, current.group_id, user.id),
        supabase.rpc('get_member_stats', { p_membership_id: current.id }).maybeSingle(),
        supabase
          .from('bets')
          .select('id, side, option_id, amount, market_id, markets!inner(title, status, closes_at, line, group_id)')
          .eq('user_id', user.id)
          .eq('markets.group_id', current.group_id)
          .is('settled_at', null)
          .not('markets.status', 'in', '(resolved,voided)')
          .order('created_at', { ascending: false }),
      ])
    : [null, null, null];

  const stats = statsResult?.data as
    | { balance: number; net: number; accuracy_pct: number | null; settled_bet_count: number; best_call_multiple: number | null; best_call_title: string | null }
    | null
    | undefined;
  // Topping up a bet adds a row; show it as one line per market and pick (same rule as the ledger).
  const openBets = [
    ...((betsResult?.data ?? []) as unknown as OpenBetRow[])
      .filter((b) => b.markets)
      .reduce((byPick, b) => {
        const key = `${b.market_id}:${b.side ?? ''}:${b.option_id ?? ''}`;
        const prev = byPick.get(key);
        byPick.set(key, prev ? { ...prev, amount: prev.amount + b.amount } : b);
        return byPick;
      }, new Map<string, OpenBetRow>())
      .values(),
  ];
  const optionIds = [...new Set(openBets.map((b) => b.option_id).filter((id): id is string => !!id))];
  const { data: options } = optionIds.length > 0 ? await supabase.from('market_options').select('id, label').in('id', optionIds) : { data: [] };
  const optionLabel = new Map((options ?? []).map((o) => [o.id, o.label as string]));
  const inPlay = openBets.reduce((sum, b) => sum + b.amount, 0);

  return (
    <>
      {current && currentGroup && switcherState && <GroupBar groupName={currentGroup.name} avatarKey={currentGroup.avatar_key} {...switcherState} />}
      <main className="mx-auto max-w-[430px] px-[18px] pt-5 pb-10">
        <div className="flex items-center gap-[13px]">
          <UserAvatar
            userId={user.id}
            nickname={handle}
            avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
            avatarPresetKey={avatarRow?.avatar_preset_key ?? null}
            className="h-[58px] w-[58px] text-[18px]"
            fallbackClassName="bg-tile text-muted"
            enlargeOnTap
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[21px] font-extrabold tracking-[-0.02em] text-ink">@{handle}</span>
            <span className="mt-0.5 block text-[12.5px] text-faint">{tenure}</span>
          </span>
          <Link
            href="/profile/account"
            aria-label="Edit profile"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-surface text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
          </Link>
        </div>

        {current && currentGroup && (
          <>
            <p className="mt-5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">In {currentGroup.name}</p>
            <div className="mt-[9px] rounded-[18px] border border-hairline bg-surface px-4 py-3.5">
              <div className="flex">
                <StatCell first label="Balance" value={formatTokens(stats?.balance ?? 0)} />
                <StatCell
                  label="Net"
                  value={stats ? formatSignedTokens(Number(stats.net)) : '0'}
                  tone={stats && Number(stats.net) > 0 ? 'gain' : stats && Number(stats.net) < 0 ? 'alert' : 'ink'}
                />
                <StatCell label="Accuracy" value={stats?.accuracy_pct != null ? `${stats.accuracy_pct}%` : '—'} />
                <StatCell label="Settled" value={String(stats?.settled_bet_count ?? 0)} />
              </div>
              {stats?.best_call_title && stats.best_call_multiple != null && (
                <p className="mt-3 border-t border-row-rule pt-2.5 text-[12px] leading-[1.45] text-muted">
                  Best call: <span className="font-semibold text-ink">{stats.best_call_title}</span>{' '}
                  <span className="font-mono font-semibold text-gain">{Number(stats.best_call_multiple).toFixed(1)}x</span>
                </p>
              )}
            </div>

            <div className="mt-5 flex items-baseline justify-between">
              <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Open bets</p>
              {openBets.length > 0 && (
                <p className="font-mono text-[11.5px] text-faint">
                  <span className="font-semibold text-ink">{formatTokens(inPlay)}</span> in play
                </p>
              )}
            </div>
            {openBets.length === 0 ? (
              <p className="mt-[9px] rounded-[18px] border border-hairline bg-surface px-4 py-3.5 text-[13px] text-faint">
                Nothing riding right now.
              </p>
            ) : (
              <div className="mt-[9px] overflow-hidden rounded-[18px] border border-hairline bg-surface">
                {openBets.map((b) => {
                  const pick = b.option_id ? (optionLabel.get(b.option_id) ?? '') : b.side ? sideTitle(b.side) : '';
                  const line = b.side === 'over' || b.side === 'under' ? (b.markets!.line != null ? ` ${b.markets!.line}` : '') : '';
                  return (
                    <Link
                      key={b.id}
                      href={`/groups/${current.group_id}/markets/${b.market_id}`}
                      className="flex items-center gap-3 border-b border-row-rule px-4 py-3 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-ink">{b.markets!.title}</span>
                        <span className="mt-0.5 block text-[12px] text-faint">
                          {pick}
                          {line}
                          {b.markets!.status !== 'open' && ' · betting closed'}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[13px] font-semibold text-ink">{formatTokens(b.amount)}</span>
                      <RowChevron className="text-faint" />
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {isAdmin && (
          <>
            <p className="mt-5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Admin</p>
            <Link href="/admin" className="mt-[9px] flex items-center gap-[11px] rounded-[18px] bg-ink px-4 py-3.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-white/12 text-surface">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
                  <circle cx="16" cy="8" r="2.2" />
                  <circle cx="10" cy="16" r="2.2" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-surface">Admin console</span>
                <span className="mt-px block text-[11.5px] text-surface/55">Platform-wide, not scoped to any one group</span>
              </span>
              <RowChevron className="text-surface/60" />
            </Link>
            <p className="mt-[7px] text-[11.5px] leading-[1.45] text-faint">Only system admins see this row.</p>
          </>
        )}

        <div className="mt-5 overflow-hidden rounded-[18px] border border-hairline bg-surface">
          {current && currentGroup && (
            <ListRow
              href={`/groups/${current.group_id}/settings/you?from=profile`}
              label={`Your name in ${currentGroup.name}`}
              hint={`@${current.nickname}`}
            />
          )}
          <ListRow href="/profile/account" label="Account" />
          <ListRow href="/profile/notifications" label="Notifications" hint="All groups" />
          <ListRow href="/feedback" label="Help and feedback" />
          <ListRow href="/privacy" label="Privacy policy" />
          <ListRow href="/terms" label="Terms" />
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-[11px] px-4 py-[13px] text-left">
              <span className="min-w-0 flex-1 text-[13.5px] font-bold text-muted">Sign out</span>
            </button>
          </form>
        </div>
      </main>
    </>
  );
}

function ListRow({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex items-center gap-[11px] border-b border-row-rule px-4 py-[13px]">
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{label}</span>
      {hint && <span className="max-w-[40%] truncate font-mono text-[12px] text-faint">{hint}</span>}
      <RowChevron className="text-faint" />
    </Link>
  );
}
