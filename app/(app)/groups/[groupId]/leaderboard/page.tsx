import Link from 'next/link';
import { standingOf } from '@/lib/standing';
import { createClient, requireUser } from '@/lib/supabase/server';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RowChevron } from '@/components/ui/Screen';
import { LeaderboardLenses } from '@/components/groups/LeaderboardLenses';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { getGroupBarSwitcherState } from '@/lib/groupBar';
import { GroupBar } from '@/components/layout/GroupBar';
import { formatTokens, formatOrdinal, formatSignedTokens, numberWord } from '@/lib/formatNumber';
import { TITLE_ORDER, type GroupTitleRow } from '@/lib/titles';
import { cn } from '@/lib/cn';

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}

type BetRow = { user_id: string; side: string | null; option_id: string | null; markets: { outcome: string | null; outcome_option_id: string | null } };

/** Correct / resolved, per member, from bets on resolved markets (void excluded — those markets
 *  resolve to status 'voided', not 'resolved'). Other members' bets are readable once a market
 *  has resolved, same read the reveal page makes. */
function accuracyByUser(rows: BetRow[]): Map<string, number> {
  const tally = new Map<string, { right: number; total: number }>();
  for (const b of rows) {
    const t = tally.get(b.user_id) ?? { right: 0, total: 0 };
    t.total += 1;
    if (b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome) t.right += 1;
    tally.set(b.user_id, t);
  }
  return new Map([...tally].map(([id, t]) => [id, Math.round((t.right / t.total) * 100)]));
}

const SEASON_HISTORY_PAGE_SIZE = 10;

/**
 * 4f / 4r. The Group tab lands here: the leaderboard for this season, with the whole history one
 * tap away on All time. Settings' one entry point is the button beside the title (the group bar
 * opens the switcher rather than linking here).
 */
export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ page?: string; lens?: string; all?: string }>;
}) {
  const { groupId } = await params;
  const { page: pageParam, lens: lensParam, all: allParam } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [{ data: settings }, { data: group }, switcherState, { data: activeMembers }, { data: leftMembers }] = await Promise.all([
    supabase.from('group_settings').select('seasons_enabled, awards_enabled, prize_text, punishment_text, seed_amount').eq('group_id', groupId).single(),
    supabase.from('groups').select('name, avatar_key, is_public, owner_id').eq('id', groupId).single(),
    getGroupBarSwitcherState(supabase, groupId, user.id),
    supabase.from('memberships').select('id, user_id, balance, status, nickname, role').eq('group_id', groupId).in('status', ['active', 'dormant']),
    supabase.from('memberships').select('id, user_id, balance, status, nickname').eq('group_id', groupId).eq('status', 'left'),
  ]);

  // A member who's left only stays on the board if they actually played (a real bet, or a
  // non-seed ledger entry) — group_members_who_played answers that without disclosing amounts.
  let members: any[] = activeMembers ?? [];
  if (leftMembers && leftMembers.length > 0) {
    const leftUserIds = leftMembers.map((m) => m.user_id);
    const leftMembershipIds = leftMembers.map((m) => m.id);
    const [{ data: leftBetRows }, { data: leftPlayedRows }] = await Promise.all([
      supabase.from('bets').select('user_id, markets!inner(group_id)').eq('markets.group_id', groupId).in('user_id', leftUserIds),
      supabase.rpc('group_members_who_played', { p_group_id: groupId, p_membership_ids: leftMembershipIds }),
    ]);
    const membershipIdToUserId = new Map(leftMembers.map((m) => [m.id, m.user_id]));
    const played = new Set([
      ...(leftBetRows ?? []).map((b: any) => b.user_id),
      ...((leftPlayedRows ?? []) as { played_membership_id: string }[])
        .map((r) => membershipIdToUserId.get(r.played_membership_id))
        .filter((id): id is string => !!id),
    ]);
    members = [...members, ...leftMembers.filter((m) => played.has(m.user_id))];
  }
  members.sort((a, b) => b.balance - a.balance);

  const isPublic = !!group?.is_public;
  const isOwner = group?.owner_id === user.id;

  // Any status, so the page knows when it's showing a season's frozen final. `latestSeason` is the
  // *next* season's row once intermission starts, so the season being recapped is number - 1.
  const { data: latestSeason } = settings?.seasons_enabled
    ? await supabase
        .from('seasons')
        .select('id, number, name, started_at, ends_at, status')
        .eq('group_id', groupId)
        .order('number', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const isIntermission = latestSeason?.status === 'intermission';
  const activeSeason = latestSeason?.status === 'active' || latestSeason?.status === 'winding_down' ? latestSeason : null;
  const { data: endedSeason } = isIntermission
    ? await supabase.from('seasons').select('id, number, name').eq('group_id', groupId).eq('number', latestSeason!.number - 1).maybeSingle()
    : { data: null };
  const scopeSeasonId = activeSeason?.id ?? endedSeason?.id ?? null;

  // Scoped bets on resolved markets — the Acc column and your accuracy tile.
  const resolvedBetsQuery = scopeSeasonId
    ? supabase
        .from('bets')
        .select('user_id, side, option_id, markets!inner(season_id, status, outcome, outcome_option_id)')
        .eq('markets.season_id', scopeSeasonId)
        .eq('markets.status', 'resolved')
    : supabase
        .from('bets')
        .select('user_id, side, option_id, markets!inner(group_id, status, outcome, outcome_option_id)')
        .eq('markets.group_id', groupId)
        .eq('markets.status', 'resolved');

  const [{ data: resolvedBets }, { data: avatarRows }, { data: titleRows }, { data: netRow }] = await Promise.all([
    resolvedBetsQuery,
    // No profile pictures in a public group, for anyone.
    isPublic ? Promise.resolve({ data: [] }) : supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', members.map((m) => m.user_id)),
    supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId),
    supabase.from('membership_ledger_net').select('net').eq('group_id', groupId).eq('user_id', user.id).maybeSingle(),
  ]);
  const accuracy = accuracyByUser((resolvedBets ?? []) as unknown as BetRow[]);
  const avatarByUser = new Map((avatarRows ?? []).map((r: any) => [r.id, r]));
  const yourTitleCount = ((titleRows ?? []) as GroupTitleRow[]).filter((r) => r.user_id === user.id).length;

  const you = members.find((m) => m.user_id === user.id);
  const yourRank = standingOf(members, user.id).rank;
  const leader = members[0];
  // "net, all season": this season's balance against what everyone was seeded with. A seasons-off
  // group has one continuous history, so it's the all-time net instead.
  const yourNet = settings?.seasons_enabled ? (you?.balance ?? 0) - (settings?.seed_amount ?? 0) : Number((netRow as { net: number } | null)?.net ?? 0);

  const dayOf = (s: { started_at: string; ends_at: string | null }) => {
    const day = Math.max(1, Math.floor((Date.now() - new Date(s.started_at).getTime()) / 86_400_000) + 1);
    const total = s.ends_at ? Math.max(day, Math.round((new Date(s.ends_at).getTime() - new Date(s.started_at).getTime()) / 86_400_000)) : null;
    return total ? `Day ${day} of ${total}` : `Day ${day}`;
  };
  const seasonLine = activeSeason
    ? `${activeSeason.name ?? `Season ${activeSeason.number}`} · ${dayOf(activeSeason)}`
    : isIntermission
      ? `${endedSeason?.name ?? `Season ${endedSeason?.number ?? ''}`} · final`
      : `${members.length} playing`;

  // ── This season (4f) ──
  const currentPane = (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-2">
        <Tile value={you && yourRank ? formatOrdinal(yourRank) : '—'} label={`of ${members.length} playing`} />
        <Tile value={formatSignedTokens(yourNet)} label={settings?.seasons_enabled ? 'net, all season' : 'net, all time'} tone={yourNet > 0 ? 'gain' : yourNet < 0 ? 'alert' : undefined} />
        <Tile value={accuracy.has(user.id) ? `${accuracy.get(user.id)}%` : '—'} label="accuracy" />
      </div>

      <div className="overflow-hidden rounded-[22px] border border-hairline bg-surface">
        <div className="flex items-center gap-2.5 border-b border-rule bg-wash px-4 py-2.5">
          <span className="w-5 text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">#</span>
          <span className="flex-1 text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Player</span>
          <span className="w-[46px] text-right text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Acc</span>
          <span className="w-[60px] text-right text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Tokens</span>
        </div>
        {members.map((m, i) => {
          const isMe = m.user_id === user.id;
          const off = leader ? leader.balance - m.balance : 0;
          const sub = isMe && i > 0 ? `${formatTokens(off)} off the top` : m.status === 'dormant' ? 'sitting out' : m.status === 'left' ? 'left' : m.balance === 0 ? 'broke' : null;
          return (
            <Link
              key={m.user_id}
              href={`/groups/${groupId}/members/${m.id}`}
              className={cn(
                'flex items-center gap-2.5 border-b border-row-rule px-4 py-3 last:border-b-0',
                isMe && 'bg-signal-wash shadow-[inset_3px_0_0_var(--color-signal)]'
              )}
            >
              <span className={cn('w-5 font-mono text-[13px]', isMe ? 'text-signal' : 'text-faint')}>{i + 1}</span>
              <span className="flex min-w-0 flex-1 items-center gap-[9px]">
                {!isPublic && (
                  <UserAvatar
                    userId={m.user_id}
                    nickname={m.nickname}
                    avatarUpdatedAt={avatarByUser.get(m.user_id)?.avatar_updated_at}
                    avatarPresetKey={avatarByUser.get(m.user_id)?.avatar_preset_key}
                    className="h-[30px] w-[30px] text-[11px]"
                    fallbackClassName="bg-tile text-muted"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-bold text-ink">
                    @{m.nickname}
                    {isMe && <span className="font-semibold text-signal"> · you</span>}
                  </span>
                  {sub && <span className={cn('block text-[11px] text-faint', isMe && 'font-mono')}>{sub}</span>}
                </span>
              </span>
              <span className="w-[46px] text-right font-mono text-[12.5px] text-muted">{accuracy.has(m.user_id) ? `${accuracy.get(m.user_id)}%` : '—'}</span>
              <span className="w-[60px] text-right font-mono text-[14px] font-semibold text-ink">{formatTokens(m.balance)}</span>
            </Link>
          );
        })}
      </div>

      {(settings?.prize_text || settings?.punishment_text || (isOwner && !isPublic)) && (
        <PlayingFor
          groupId={groupId}
          prizeText={settings?.prize_text ?? null}
          punishmentText={settings?.punishment_text ?? null}
          lastPlace={members.length}
          canEdit={isOwner && !isPublic}
        />
      )}

      {settings?.awards_enabled && (
        <Link href={`/groups/${groupId}/awards`} className="flex items-center gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-3.5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-signal-tint">
            <AwardGlyph iconKey="target" stroke="var(--color-signal)" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold text-ink">Awards</span>
            <span className="mt-0.5 block text-[11.5px] text-faint">
              {yourTitleCount > 0 ? `You hold ${numberWord(yourTitleCount)} of ${numberWord(TITLE_ORDER.length)} titles` : 'Who holds each standing title'}
            </span>
          </span>
          <RowChevron className="text-faint" />
        </Link>
      )}
    </div>
  );

  // ── All time (4r) ──
  let allTimePane: React.ReactNode = null;
  let allTimeSubtitle: string | null = null;
  if (settings?.seasons_enabled) {
    const page = Math.max(1, Number(pageParam) || 1);
    const from = (page - 1) * SEASON_HISTORY_PAGE_SIZE;

    const [{ data: standingsRows }, { data: mySettledBets }, { count: myBetCount }, { data: seasonRows }, { data: resultRows }] = await Promise.all([
      // Every member's real all-time net, computed under elevated privilege (membership_ledger_net
      // is own-rows-only, so a plain select would show everyone else as 0).
      supabase.rpc('get_group_all_time_standings', { p_group_id: groupId }),
      supabase
        .from('bets')
        .select('user_id, side, option_id, markets!inner(group_id, status, outcome, outcome_option_id)')
        .eq('user_id', user.id)
        .eq('markets.group_id', groupId)
        .eq('markets.status', 'resolved'),
      supabase.from('bets').select('id, markets!inner(group_id)', { count: 'exact', head: true }).eq('markets.group_id', groupId).eq('user_id', user.id),
      supabase
        .from('seasons')
        .select('id, number, name, started_at, ends_at, ended_at, status')
        .eq('group_id', groupId)
        .in('status', ['active', 'winding_down', 'archived'])
        .order('number', { ascending: false })
        .range(from, from + SEASON_HISTORY_PAGE_SIZE),
      supabase.from('season_results').select('season_id, snapshot').eq('group_id', groupId),
    ]);

    const standings = (standingsRows ?? []) as { user_id: string; nickname: string; net: number; seasons_won: number }[];
    const mine = standings.find((s) => s.user_id === user.id);
    const myNet = Number(mine?.net ?? 0);
    const myAccuracy = accuracyByUser((mySettledBets ?? []) as unknown as BetRow[]).get(user.id);
    const snapshotBySeason = new Map(
      (resultRows ?? []).map((r) => [r.season_id, r.snapshot as { champion?: { user_id: string; nickname: string }; final_balances?: { user_id: string }[] }])
    );
    const seasons = (seasonRows ?? []).slice(0, SEASON_HISTORY_PAGE_SIZE);
    const hasNextPage = (seasonRows ?? []).length > SEASON_HISTORY_PAGE_SIZE;
    const pageLink = (p: number) => `/groups/${groupId}/leaderboard?lens=alltime&page=${p}`;

    const { data: firstSeason } = await supabase.from('seasons').select('started_at').eq('group_id', groupId).order('number').limit(1).maybeSingle();
    const { count: seasonCount } = await supabase.from('seasons').select('id', { count: 'exact', head: true }).eq('group_id', groupId).neq('status', 'intermission');
    allTimeSubtitle = firstSeason
      ? `${seasonCount ?? 0} season${seasonCount === 1 ? '' : 's'} since ${new Date(firstSeason.started_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
      : null;

    const standingAvatarIds = standings.map((s) => s.user_id).filter((id) => !avatarByUser.has(id));
    const { data: moreAvatars } =
      standingAvatarIds.length > 0 && !isPublic
        ? await supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', standingAvatarIds)
        : { data: [] };
    for (const r of moreAvatars ?? []) avatarByUser.set(r.id, r);

    const showAll = allParam === '1';
    const shownStandings = showAll ? standings : standings.slice(0, 3);

    allTimePane = (
      <div className="flex flex-col gap-[11px]">
        <div className="rounded-[22px] bg-ink px-[18px] py-[13px]">
          <p className="text-[10.5px] font-bold tracking-[0.1em] text-surface/50 uppercase">Your record here</p>
          <div className="mt-[11px] flex gap-3.5">
            <RecordStat value={formatSignedTokens(myNet)} label="net" accent />
            <RecordStat value={String(mine?.seasons_won ?? 0)} label={(mine?.seasons_won ?? 0) === 1 ? 'season won' : 'seasons won'} />
            <RecordStat value={myAccuracy == null ? '—' : `${myAccuracy}%`} label="accuracy" />
            <RecordStat value={String(myBetCount ?? 0)} label="bets" />
          </div>
        </div>

        {standings.length > 0 && (
          <div className="overflow-hidden rounded-[22px] border border-hairline bg-surface">
            <div className="flex items-center gap-2.5 border-b border-rule bg-wash px-4 py-2.5">
              <span className="w-[18px] text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">#</span>
              <span className="flex-1 text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Player</span>
              <span className="w-10 text-right text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Won</span>
              <span className="w-[62px] text-right text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Net</span>
            </div>
            {shownStandings.map((s) => {
              const isYou = s.user_id === user.id;
              const rank = standings.indexOf(s) + 1;
              const av = avatarByUser.get(s.user_id);
              return (
                <div
                  key={s.user_id}
                  className={cn('flex items-center gap-2.5 border-b border-row-rule px-4 py-[11px]', isYou && 'bg-signal-wash shadow-[inset_3px_0_0_var(--color-signal)]')}
                >
                  <span className={cn('w-[18px] font-mono text-[13px]', isYou ? 'text-signal' : 'text-faint')}>{rank}</span>
                  {!isPublic && (
                    <UserAvatar
                      userId={s.user_id}
                      nickname={s.nickname}
                      avatarUpdatedAt={av?.avatar_updated_at}
                      avatarPresetKey={av?.avatar_preset_key}
                      className="h-7 w-7 text-[10px]"
                      fallbackClassName="bg-tile text-muted"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">
                    @{s.nickname}
                    {isYou && <span className="font-semibold text-signal"> · you</span>}
                  </span>
                  <span className="w-10 text-right font-mono text-[12.5px] text-muted">{s.seasons_won}</span>
                  <span className={cn('w-[62px] text-right font-mono text-[13.5px] font-semibold', s.net >= 0 ? 'text-gain' : 'text-alert')}>
                    {formatSignedTokens(Number(s.net))}
                  </span>
                </div>
              );
            })}
            {!showAll && standings.length > shownStandings.length && (
              <Link href={`/groups/${groupId}/leaderboard?lens=alltime&all=1`} className="flex items-center justify-between gap-2.5 border-t border-rule bg-wash px-4 py-[11px]">
                <span className="text-[12px] font-bold text-signal">All {standings.length} who have played · full ledger</span>
                <RowChevron className="text-signal" />
              </Link>
            )}
          </div>
        )}

        {seasons.length > 0 && (
          <>
            <p className="mt-px text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Recent seasons</p>
            <div className="overflow-hidden rounded-[22px] border border-hairline bg-surface">
              {seasons.map((s) => {
                const snap = snapshotBySeason.get(s.id);
                const running = s.status !== 'archived';
                const myFinal = snap?.final_balances ? snap.final_balances.findIndex((r) => r.user_id === user.id) + 1 : 0;
                const title = `Season ${s.number}${s.name ? ` · ${s.name}` : ''}`;
                const sub = running
                  ? `${dayOf(s)}${yourRank ? ` · you are ${formatOrdinal(yourRank)}` : ''}`
                  : `Ended ${s.ended_at ? formatShortDate(s.ended_at) : ''}${myFinal > 0 ? ` · you were ${formatOrdinal(myFinal)}` : ''}`;
                const champ = snap?.champion;
                const champAvatar = champ ? avatarByUser.get(champ.user_id) : undefined;
                return (
                  <Link
                    key={s.id}
                    href={running ? `/groups/${groupId}/leaderboard` : `/groups/${groupId}/recap?season=${s.number}`}
                    className="flex items-center gap-[11px] border-b border-row-rule px-4 py-[11px] last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink">{title}</span>
                      <span className="mt-px block truncate text-[11.5px] text-faint">{sub}</span>
                    </span>
                    {running ? (
                      <span className="shrink-0 rounded-lg border border-signal-edge bg-signal-tint px-[9px] py-1 text-[10.5px] font-bold text-signal">Running</span>
                    ) : champ ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        {!isPublic && (
                          <UserAvatar
                            userId={champ.user_id}
                            nickname={champ.nickname}
                            avatarUpdatedAt={champAvatar?.avatar_updated_at}
                            avatarPresetKey={champAvatar?.avatar_preset_key}
                            className="h-[22px] w-[22px] text-[8px]"
                            fallbackClassName="bg-tile text-muted"
                          />
                        )}
                        <span className="text-[12px] font-bold text-muted">won</span>
                      </span>
                    ) : null}
                    <RowChevron className="text-faint" />
                  </Link>
                );
              })}
            </div>
            {(page > 1 || hasNextPage) && (
              <div className="flex items-center justify-between text-[12.5px] font-bold text-signal">
                {page > 1 ? <Link href={pageLink(page - 1)}>Newer</Link> : <span />}
                {hasNextPage && <Link href={pageLink(page + 1)}>Older</Link>}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Rendered here for both lenses and handed over as two finished headers: LeaderboardLenses is a
  // client component, and a function prop can't be passed to one from a server page.
  const header = (lens: 'current' | 'alltime') => (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <h1 className="text-[25px] font-extrabold tracking-[-0.022em] text-ink">Leaderboard</h1>
        <p className="mt-1.5 text-[13px] text-faint">{lens === 'alltime' && allTimeSubtitle ? allTimeSubtitle : seasonLine}</p>
      </span>
      {lens === 'current' && (
        <span className="flex shrink-0 items-center gap-1.5">
        {!isPublic && (
          <Link
            href={`/groups/${groupId}/invite`}
            className="flex shrink-0 items-center gap-[7px] rounded-[11px] border border-hairline bg-surface px-3 py-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="text-ink">
              <circle cx="10" cy="8" r="3.6" />
              <path d="M3.5 19.5c1.2-3.2 3.6-4.8 6.5-4.8s5.3 1.6 6.5 4.8M19 8v6M16 11h6" />
            </svg>
            <span className="text-[12.5px] font-bold text-ink">Invite</span>
          </Link>
        )}
        <Link
          href={`/groups/${groupId}/settings`}
          className="flex shrink-0 items-center gap-[7px] rounded-[11px] border border-hairline bg-surface px-3 py-2"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ink">
            <circle cx="12" cy="12" r="3.1" />
            <path d="M19.1 14.4a1.5 1.5 0 0 0 .3 1.65l.05.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V20a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.05A1.8 1.8 0 1 1 5.45 16.3l.05-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H4a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.06A1.8 1.8 0 1 1 7.67 4.85l.06.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V3.7a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9H20a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.37.9z" />
          </svg>
          <span className="text-[12.5px] font-bold text-ink">Settings</span>
        </Link>
        </span>
      )}
    </div>
  );

  return (
    <>
      <GroupBar groupName={group!.name} avatarKey={group!.avatar_key} {...switcherState} />
      <main className="mx-auto flex max-w-[430px] flex-col px-[18px] pt-5 pb-10">
        <LeaderboardLenses
          initialLens={lensParam === 'alltime' && allTimePane ? 'alltime' : 'current'}
          currentHeader={header('current')}
          allTimeHeader={header('alltime')}
          currentLabel={isIntermission ? 'Final table' : 'This season'}
          current={currentPane}
          allTime={allTimePane}
        />
      </main>
    </>
  );
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'gain' | 'alert' }) {
  return (
    <div className="min-w-0 flex-1 rounded-[18px] border border-hairline bg-surface px-3.5 py-[13px]">
      <p className={cn('truncate font-mono text-[21px] font-semibold', tone === 'gain' ? 'text-gain' : tone === 'alert' ? 'text-alert' : 'text-ink')}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-faint">{label}</p>
    </div>
  );
}

function RecordStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn('block truncate font-mono text-[22px] leading-none font-semibold', accent ? 'text-on-ink' : 'text-surface')}>{value}</span>
      <span className="mt-1 block text-[11px] font-semibold text-surface/55">{label}</span>
    </span>
  );
}

/** 4f's "Playing for": 1st in an ink chip with the prize, last place in an alert chip with the
 *  punishment. For the owner the card links to the stakes editor, including an empty prompt. */
function PlayingFor({
  groupId,
  prizeText,
  punishmentText,
  lastPlace,
  canEdit,
}: {
  groupId: string;
  prizeText: string | null;
  punishmentText: string | null;
  lastPlace: number;
  canEdit: boolean;
}) {
  const body = (
    <div className="rounded-[22px] border border-hairline bg-surface px-[18px] pt-[15px] pb-1.5">
      <p className="mb-1 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Playing for</p>
      {prizeText && (
        <div className="flex items-center gap-3 border-t border-rule py-3">
          <span className="flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-ink font-mono text-[12px] font-semibold text-surface">1st</span>
          <span className="min-w-0 flex-1 text-[13.5px] leading-[1.4] font-bold text-ink">{prizeText}</span>
        </div>
      )}
      {punishmentText && (
        <div className="flex items-center gap-3 border-t border-rule py-3">
          <span className="flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-alert-line bg-alert-bg font-mono text-[12px] font-semibold text-alert">
            {formatOrdinal(Math.max(lastPlace, 2))}
          </span>
          <span className="min-w-0 flex-1 text-[13.5px] leading-[1.4] font-bold text-ink">{punishmentText}</span>
        </div>
      )}
      {!prizeText && !punishmentText && (
        <div className="flex items-center gap-3 border-t border-rule py-3">
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-muted">Add a prize and a punishment</span>
          <RowChevron className="text-faint" />
        </div>
      )}
    </div>
  );
  return canEdit ? <Link href={`/groups/${groupId}/settings/stakes?from=leaderboard`}>{body}</Link> : body;
}

