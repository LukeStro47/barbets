import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { LeaderboardLenses } from '@/components/groups/LeaderboardLenses';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { ChevronRightIcon } from '@/components/ui/icons';
import { formatTokens, formatOrdinal, numberWord } from '@/lib/formatNumber';
import { titlesByUser, TITLE_ORDER, type GroupTitleRow } from '@/lib/titles';

function medal(rank: number): string {
  return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`;
}

/** "Aug 1, '26" — short enough to sit next to the season number without wrapping. */
function formatSeasonDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}, '${String(d.getFullYear()).slice(2)}`;
}

const SEASON_HISTORY_PAGE_SIZE = 10;

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ page?: string; lens?: string }>;
}) {
  const { groupId } = await params;
  const { page: pageParam, lens: lensParam } = await searchParams;
  const supabase = await createClient();

  const user = await requireUser(supabase);

  const { data: settings } = await supabase.from('group_settings').select('seasons_enabled').eq('group_id', groupId).single();

  const { data: activeMembers } = await supabase
    .from('memberships')
    .select('id, user_id, balance, status, nickname')
    .eq('group_id', groupId)
    .in('status', ['active', 'dormant']);

  // A member who's left only stays on the leaderboard if they actually played — otherwise
  // leaving is clean, with no trace anywhere. "Played" means a real bet, or a non-seed ledger
  // entry (covers e.g. a zero-winner-pool creator/endorser cut with no bet of their own).
  const { data: leftMembers } = await supabase
    .from('memberships')
    .select('id, user_id, balance, status, nickname')
    .eq('group_id', groupId)
    .eq('status', 'left');

  let members: any[] = activeMembers ?? [];
  if (leftMembers && leftMembers.length > 0) {
    const leftUserIds = leftMembers.map((m) => m.user_id);
    const leftMembershipIds = leftMembers.map((m) => m.id);
    const [{ data: leftBetRows }, { data: leftLedgerRows }] = await Promise.all([
      supabase.from('bets').select('user_id, markets!inner(group_id)').eq('markets.group_id', groupId).in('user_id', leftUserIds),
      supabase.from('ledger').select('membership_id').in('membership_id', leftMembershipIds).neq('reason', 'seed'),
    ]);
    const membershipIdToUserId = new Map(leftMembers.map((m) => [m.id, m.user_id]));
    const activeLeftUserIds = new Set([
      ...(leftBetRows ?? []).map((b: any) => b.user_id),
      ...(leftLedgerRows ?? []).map((l: any) => membershipIdToUserId.get(l.membership_id)).filter((id): id is string => !!id),
    ]);
    members = [...members, ...leftMembers.filter((m) => activeLeftUserIds.has(m.user_id))];
  }
  members.sort((a, b) => b.balance - a.balance);

  const { data: titleRows } = await supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId);
  const badges = titlesByUser((titleRows ?? []) as GroupTitleRow[]);
  const yourTitleCount = ((titleRows ?? []) as GroupTitleRow[]).filter((r) => r.user_id && r.user_id === user?.id).length;

  // ---- The hero: who's in front, and where you are relative to them. Both figures already exist
  // in `members`; the only extra reads are the season this is all happening in and the leader's
  // last seven days, which is what turns a standing into a direction of travel.
  const { data: heroSeason } = settings?.seasons_enabled
    ? await supabase.from('seasons').select('number, name, started_at').eq('group_id', groupId).eq('status', 'active').maybeSingle()
    : { data: null };

  const leader = members[0];
  const you = members.find((m: any) => m.user_id === user?.id);
  const yourRank = members.findIndex((m: any) => m.user_id === user?.id) + 1;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { data: leaderWeekRows } = leader?.id
    ? await supabase.from('ledger').select('amount').eq('membership_id', leader.id).neq('reason', 'seed').gte('created_at', weekAgo)
    : { data: [] };
  const leaderWeekDelta = (leaderWeekRows ?? []).reduce((sum, r) => sum + r.amount, 0);
  const leaderTrend =
    leaderWeekDelta > 0
      ? `up ${formatTokens(leaderWeekDelta)} this week`
      : leaderWeekDelta < 0
        ? `down ${formatTokens(Math.abs(leaderWeekDelta))} this week`
        : 'level this week';

  const seasonLine = heroSeason
    ? `${heroSeason.name ?? `Season ${heroSeason.number}`} · day ${Math.max(
        1,
        Math.floor((Date.now() - new Date(heroSeason.started_at).getTime()) / (24 * 60 * 60_000)) + 1
      )}`
    : null;

  // Leading the board makes "behind the leader" a zero that says nothing, so the third stat flips
  // to the lead you're actually defending.
  const youLead = !!you && yourRank === 1;
  const gapValue = youLead
    ? leader.balance - (members[1]?.balance ?? leader.balance)
    : Math.max(0, (leader?.balance ?? 0) - (you?.balance ?? 0));

  const hero = leader && (
    <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-[18px]">
      <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_90%_0%,rgba(232,163,61,0.3),rgba(232,163,61,0)_60%)]" />
      <div className="relative flex items-center gap-3.5">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-honey-300/50 bg-honey-500/[0.18] text-[15px] font-extrabold text-honey-300">
          {leader.nickname.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold tracking-[0.1em] text-honey-300 uppercase">Out in front</span>
          <Mention nickname={leader.nickname} className="mt-0.5 block truncate text-[19px] font-extrabold tracking-[-0.015em] text-paper-white" />
          <span className="mt-0.5 block text-xs text-paper-white/55">
            {formatTokens(leader.balance)} tokens · {leaderTrend}
          </span>
        </span>
      </div>
      <div className="relative mt-[15px] flex gap-3 border-t border-white/10 pt-3.5">
        <span className="flex-1">
          <span className="block text-xl font-extrabold tabular-nums text-paper-white">{you ? formatOrdinal(yourRank) : '—'}</span>
          <span className="mt-px block text-[10px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">
            {you ? `you, of ${members.length}` : `${members.length} playing`}
          </span>
        </span>
        <span className="flex-1">
          <span className="block text-xl font-extrabold tabular-nums text-honey-300">{formatTokens(you?.balance ?? 0)}</span>
          <span className="mt-px block text-[10px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">your tokens</span>
        </span>
        <span className="flex-1">
          <span className="block text-xl font-extrabold tabular-nums text-paper-white">{formatTokens(gapValue)}</span>
          <span className="mt-px block text-[10px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">
            {youLead ? 'clear of 2nd' : 'behind the leader'}
          </span>
        </span>
      </div>
    </div>
  );

  const standingsSection = (
    <Card className="space-y-2">
      {(() => {
        const top = members?.[0]?.balance || 1;
        return (members ?? []).map((m: any, i: number) => {
          const isMe = m.user_id === user?.id;
          const pct = Math.max(9, Math.round((m.balance / top) * 100));
          return (
            <div
              key={m.user_id}
              className={`relative h-[54px] overflow-hidden rounded-2xl bg-espresso-50 ${
                isMe ? 'border-[1.5px] border-honey-500' : 'border-[1.5px] border-transparent'
              }`}
            >
              <span
                className={`absolute inset-y-0 left-0 ${isMe ? 'bg-honey-500' : 'bg-honey-500/30'}`}
                style={{ width: `${pct}%` }}
              />
              <span className="absolute inset-0 flex items-center gap-2.5 px-3">
                <span className="w-5 shrink-0 text-center text-xs font-extrabold text-espresso-500">{medal(i)}</span>
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-white text-xs font-extrabold text-espresso-700 ${
                    isMe ? 'border-2 border-honey-500' : 'border-[1.5px] border-espresso-100'
                  }`}
                >
                  {m.nickname.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <Mention nickname={m.nickname} titles={badges.get(m.user_id)} className="block truncate text-[13.5px] font-bold text-espresso-900" />
                  {(m.balance === 0 || m.status !== 'active') && (
                    <span className="block text-[10.5px] font-semibold text-espresso-400">
                      {m.balance === 0 && 'Broke'}
                      {m.balance === 0 && m.status !== 'active' && ' · '}
                      {m.status === 'dormant' && 'Sitting out'}
                      {m.status === 'left' && 'Left'}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-display text-[15px] font-extrabold tabular-nums text-espresso-900">
                  {formatTokens(m.balance)}
                </span>
              </span>
            </div>
          );
        });
      })()}
      <p className="pt-1 text-[11.5px] text-espresso-400">Bar length is share of the group's tokens. Your row is outlined.</p>
    </Card>
  );

  let allTimeSection: React.ReactNode = null;
  if (settings?.seasons_enabled) {
    const page = Math.max(1, Number(pageParam) || 1);
    const from = (page - 1) * SEASON_HISTORY_PAGE_SIZE;
    const to = from + SEASON_HISTORY_PAGE_SIZE; // fetch one extra to know whether a Next page exists

    const { data: myMembership } = await supabase
      .from('memberships')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .single();

    const [{ data: ledgerRows }, { data: settledBets }, { data: resultsPage }] = await Promise.all([
      myMembership
        ? supabase.from('ledger').select('amount').eq('membership_id', myMembership.id).neq('reason', 'seed')
        : Promise.resolve({ data: [] }),
      supabase
        .from('bets')
        .select('side, option_id, markets!inner(group_id, status, outcome, outcome_option_id)')
        .eq('user_id', user.id)
        .eq('markets.group_id', groupId)
        .eq('markets.status', 'resolved'),
      supabase
        .from('season_results')
        .select('snapshot, seasons(number, started_at, ended_at, name)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .range(from, to),
    ]);

    const myNet = (ledgerRows ?? []).reduce((sum, r) => sum + r.amount, 0);
    const correctCount = (settledBets ?? []).filter((b: any) =>
      b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome
    ).length;
    const myAccuracy = (settledBets?.length ?? 0) > 0 ? Math.round((correctCount / settledBets!.length) * 100) : null;

    const hasNextPage = (resultsPage ?? []).length > SEASON_HISTORY_PAGE_SIZE;
    const results = (resultsPage ?? []).slice(0, SEASON_HISTORY_PAGE_SIZE);
    const pageLink = (p: number) => `/groups/${groupId}/leaderboard?lens=alltime&page=${p}`;

    allTimeSection = (
      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 font-display font-bold text-espresso-800">Your all-time</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={`font-display text-2xl font-bold tabular-nums ${myNet >= 0 ? 'text-honey-600' : 'text-espresso-400'}`}>
                {myNet >= 0 ? '+' : '−'}
                {formatTokens(Math.abs(myNet))}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-espresso-400">Net across every season</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold tabular-nums text-espresso-900">{myAccuracy == null ? '—' : `${myAccuracy}%`}</p>
              <p className="mt-0.5 text-xs font-semibold text-espresso-400">Accuracy</p>
            </div>
          </div>
        </Card>

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-espresso-400">Season history</h2>
          {(results ?? []).length === 0 && page === 1 ? (
            <EmptyState icon="🏆" title="No seasons in the books yet" subtitle="History shows up here once a season ends." />
          ) : (
            <div className="space-y-4">
              {(results ?? []).map((r: any, i: number) => (
                <Card key={i}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-bold text-espresso-800">{r.seasons?.name ?? `Season ${r.seasons?.number}`}</h3>
                    <span className="text-xs text-espresso-400">
                      {r.seasons?.started_at && formatSeasonDate(r.seasons.started_at)} –{' '}
                      {r.seasons?.ended_at && formatSeasonDate(r.seasons.ended_at)}
                    </span>
                  </div>

                  {r.snapshot.champion && (
                    <div className="mt-3.5 flex items-center gap-3.5 rounded-2xl bg-honey-50 px-4 py-3.5">
                      <span className="flex h-12 w-12 shrink-0 -rotate-6 items-center justify-center rounded-full border-2 border-honey-500 bg-espresso-900 text-2xl shadow-[0_8px_16px_-6px_rgba(232,163,61,0.55)]">
                        🏆
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold tracking-[0.1em] text-honey-700 uppercase">Champion</p>
                        <p className="truncate font-display text-lg font-bold text-espresso-900">
                          <Mention nickname={r.snapshot.champion.nickname} />
                        </p>
                        <p className="text-sm font-semibold text-honey-700">{formatTokens(r.snapshot.champion.balance)} tokens</p>
                      </div>
                    </div>
                  )}

                  {/* Perforated ticket-stub divider, same punch-hole trick RevealTicket uses between
                      its header and odds sections. */}
                  <div className="relative -mx-5 mt-4 border-t-2 border-dashed border-espresso-100">
                    <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
                    <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
                    {r.snapshot.biggest_single_win && (
                      <div>
                        <p className="font-semibold text-espresso-700">Biggest win</p>
                        <p className="text-espresso-500">
                          <Mention nickname={r.snapshot.biggest_single_win.nickname} /> +
                          {formatTokens(r.snapshot.biggest_single_win.amount)}
                        </p>
                      </div>
                    )}
                    {r.snapshot.worst_beat && (
                      <div>
                        <p className="font-semibold text-espresso-700">Worst beat</p>
                        <p className="text-espresso-500">
                          <Mention nickname={r.snapshot.worst_beat.nickname} /> −{formatTokens(r.snapshot.worst_beat.amount)}
                        </p>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {(page > 1 || hasNextPage) && (
            <div className="mt-4 flex items-center justify-between text-sm font-semibold">
              {page > 1 ? (
                <Link href={pageLink(page - 1)} className="text-honey-700 hover:text-honey-800">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              {hasNextPage && (
                <Link href={pageLink(page + 1)} className="text-honey-700 hover:text-honey-800">
                  Older →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-3.5 px-5 py-8">
      <PageHeader
        title="Leaderboard"
        action={seasonLine && <span className="shrink-0 text-[11.5px] font-extrabold text-espresso-400">{seasonLine}</span>}
      />

      {hero}

      {settings?.seasons_enabled ? (
        <LeaderboardLenses initialLens={lensParam === 'alltime' ? 'alltime' : 'current'} current={standingsSection} allTime={allTimeSection} />
      ) : (
        standingsSection
      )}

      <Link
        href={`/groups/${groupId}/awards`}
        className="flex items-center gap-3 rounded-[18px] border border-espresso-100 bg-paper-white px-3.5 py-3"
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-honey-50">
          <AwardGlyph titleKey="oracle" stroke="var(--color-honey-700)" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-espresso-950">Awards</span>
          <span className="mt-0.5 block text-[11.5px] text-espresso-400">
            {yourTitleCount > 0
              ? `You hold ${numberWord(yourTitleCount)} of ${numberWord(TITLE_ORDER.length)} titles`
              : 'See who holds each standing title'}
          </span>
        </span>
        <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-espresso-300" />
      </Link>
    </main>
  );
}
