import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { LeaderboardLenses } from '@/components/groups/LeaderboardLenses';
import { SeasonStakesBand } from '@/components/groups/SeasonStakesBand';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { ChevronRightIcon } from '@/components/ui/icons';
import { formatTokens, formatOrdinal, numberWord } from '@/lib/formatNumber';
import { TITLE_ORDER, type GroupTitleRow } from '@/lib/titles';
import { cn } from '@/lib/cn';

/** Rank numeral — no medals; order is the information. */
function rankLabel(rank: number): string {
  return `${rank + 1}`;
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

  const { data: settings } = await supabase
    .from('group_settings')
    .select('seasons_enabled, awards_enabled, prize_text, punishment_text')
    .eq('group_id', groupId)
    .single();
  const { data: group } = await supabase.from('groups').select('is_public, owner_id').eq('id', groupId).single();

  const { data: activeMembers } = await supabase
    .from('memberships')
    .select('id, user_id, balance, status, nickname, role')
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
    const [{ data: leftBetRows }, { data: leftPlayedRows }] = await Promise.all([
      supabase.from('bets').select('user_id, markets!inner(group_id)').eq('markets.group_id', groupId).in('user_id', leftUserIds),
      // Not a direct `ledger` read, and not membership_ledger_net either: both are own-rows-only
      // for the caller, so asking either about someone *else* silently answers "no" and this whole
      // half of the OR does nothing. group_members_who_played is SECURITY DEFINER and returns
      // membership ids only, never amounts (see its migration for why that disclosure is the
      // narrow one). It also answers as soon as a bet is placed, where the `bets` half above has
      // to wait for the market to resolve before other members can see it.
      supabase.rpc('group_members_who_played', { p_group_id: groupId, p_membership_ids: leftMembershipIds }),
    ]);
    const membershipIdToUserId = new Map(leftMembers.map((m) => [m.id, m.user_id]));
    const activeLeftUserIds = new Set([
      ...(leftBetRows ?? []).map((b: any) => b.user_id),
      ...((leftPlayedRows ?? []) as { played_membership_id: string }[])
        .map((r) => membershipIdToUserId.get(r.played_membership_id))
        .filter((id): id is string => !!id),
    ]);
    members = [...members, ...leftMembers.filter((m) => activeLeftUserIds.has(m.user_id))];
  }
  members.sort((a, b) => b.balance - a.balance);

  const isOwner = group?.owner_id === user?.id;
  const canEditStakes = isOwner && !group?.is_public;

  // One batched lookup for every member's avatar rather than a query inside the row loop below
  // (see lib/groupFeed.ts's "no query inside a per-market loop" rule, same idea applied here).
  // No profile pictures in a public group, for anyone — an empty map means every UserAvatar below
  // falls back to initials, same as a member who never uploaded a photo.
  const { data: avatarRows } = group?.is_public
    ? { data: [] }
    : await supabase
        .from('users')
        .select('id, avatar_updated_at, avatar_preset_key')
        .in(
          'id',
          members.map((m) => m.user_id)
        );
  const avatarByUser = new Map((avatarRows ?? []).map((r) => [r.id, r]));

  const { data: titleRows } = await supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId);
  const yourTitleCount = ((titleRows ?? []) as GroupTitleRow[]).filter((r) => r.user_id && r.user_id === user?.id).length;

  // ---- The hero: who's in front, and where you are relative to them. Both figures already exist
  // in `members`; the only extra read is the season this is all happening in.
  //
  // There used to be a "up N this week" trend line beside the leader's total, built from their
  // last seven days of `ledger`. It was removed rather than fixed: `ledger_select_own` is
  // own-rows-only, so that query returned zero rows for every viewer except the leader
  // themselves, and the fallback branch confidently told everyone else "level this week" no
  // matter what had actually happened. Restoring it means a SECURITY DEFINER function and a
  // deliberate decision that one member's weekly swing is another's to see, which is a product
  // question rather than a bug fix. Don't re-add it by reading `ledger` directly; that is the
  // version that silently doesn't work.
  // Any status, not just active — this is how the hero and lens label know to switch into their
  // season-over framing. Note `latestSeason` is the *next* season's row once intermission starts
  // (see _finalize_season), so the season this page is actually recapping is number - 1.
  const { data: latestSeason } = settings?.seasons_enabled
    ? await supabase.from('seasons').select('id, number, name, started_at, status').eq('group_id', groupId).order('number', { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const isIntermission = latestSeason?.status === 'intermission';
  const heroSeason = latestSeason?.status === 'active' ? latestSeason : null;

  const { data: endedSeason } = isIntermission
    ? await supabase.from('seasons').select('id, number, name').eq('group_id', groupId).eq('number', latestSeason!.number - 1).maybeSingle()
    : { data: null };

  // Scoped to whichever season the standings below actually reflect — an active season's own
  // bets, or the just-ended one during intermission's frozen final view — not the group's whole
  // history, since a brand-new season starts everyone tied again regardless of how many seasons
  // came before it. Off entirely (seasons disabled), there's only the one continuous history.
  const scopeSeasonId = heroSeason?.id ?? endedSeason?.id ?? null;
  const { count: totalBetCount } = scopeSeasonId
    ? await supabase.from('bets').select('id, markets!inner(season_id)', { count: 'exact', head: true }).eq('markets.season_id', scopeSeasonId)
    : await supabase.from('bets').select('id, markets!inner(group_id)', { count: 'exact', head: true }).eq('markets.group_id', groupId);
  // Every member is still tied at the seed amount, so "leader" is just whoever the query happened
  // to sort first — the hero and the standings list both soften their language for it below.
  const noBetsPlaced = (totalBetCount ?? 0) === 0;

  // members is sorted by live balance, which during intermission is exactly the frozen final
  // standing — nothing touches it again until start_season reseeds everyone — so the "final
  // table" here needs no separate season_results read of its own.
  const you = members.find((m: any) => m.user_id === user?.id);
  const yourRank = members.findIndex((m: any) => m.user_id === user?.id) + 1;
  // Everyone's still tied at the seed amount, so members[0] is just whoever the query happened to
  // sort first (in practice, often the newest joiner) — showing the viewer their own profile in
  // that slot reads as "you" instead of an arbitrary stranger before there's any real standing to show.
  const leader = noBetsPlaced ? (you ?? members[0]) : members[0];

  const seasonLine = heroSeason
    ? `${heroSeason.name ?? `Season ${heroSeason.number}`} · Day ${Math.max(
        1,
        Math.floor((Date.now() - new Date(heroSeason.started_at).getTime()) / (24 * 60 * 60_000)) + 1
      )}`
    : isIntermission
      ? `${endedSeason?.name ?? `Season ${endedSeason?.number ?? ''}`} · final`
      : null;

  // Leading the board makes "behind the leader" a zero that says nothing, so the third stat flips
  // to the lead you're actually defending.
  const youLead = !!you && yourRank === 1;
  const gapValue = youLead
    ? leader.balance - (members[1]?.balance ?? leader.balance)
    : Math.max(0, (leader?.balance ?? 0) - (you?.balance ?? 0));

  const hero = leader && (
    <div className="relative overflow-hidden rounded-[26px] bg-ink p-[18px]">
      <Link href={`/groups/${groupId}/members/${leader.id}`} className="relative flex items-center gap-3.5">
        {/* Not even an initials placeholder in a public group — no avatar chip at all, not just no
            photo, since the empty circle still reads as "a person's picture goes here". */}
        {!group?.is_public && (
          <UserAvatar
            userId={leader.user_id}
            nickname={leader.nickname}
            avatarUpdatedAt={avatarByUser.get(leader.user_id)?.avatar_updated_at}
            avatarPresetKey={avatarByUser.get(leader.user_id)?.avatar_preset_key}
            className="h-[52px] w-[52px] border border-white/15 text-[15px]"
            fallbackClassName="bg-white/[0.08] text-on-ink"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-bold tracking-[0.1em] text-on-ink uppercase">
            {noBetsPlaced ? "Nobody's bet yet" : isIntermission ? 'Took the season' : 'Out in front'}
          </span>
          <Mention nickname={leader.nickname} className="mt-0.5 block truncate text-[19px] font-extrabold tracking-[-0.015em] text-white" />
          <span className="mt-0.5 block font-mono text-[12.5px] font-semibold text-white/55">{formatTokens(leader.balance)}</span>
        </span>
        <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-white/40" />
      </Link>
      <div className="relative mt-[15px] flex gap-3 border-t border-white/10 pt-3.5">
        <span className="flex-1">
          <span className="block font-mono text-[20px] font-semibold tracking-tight text-white">
            {noBetsPlaced ? '—' : you ? formatOrdinal(yourRank) : '—'}
          </span>
          <span className="mt-px block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">
            {noBetsPlaced ? 'not ranked yet' : you ? `you, of ${members.length}` : `${members.length} playing`}
          </span>
        </span>
        <span className="flex-1">
          <span className="block font-mono text-[20px] font-semibold tracking-tight text-on-ink">{formatTokens(you?.balance ?? 0)}</span>
          <span className="mt-px block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">
            {isIntermission ? 'your final' : 'your tokens'}
          </span>
        </span>
        <span className="flex-1">
          <span className="block font-mono text-[20px] font-semibold tracking-tight text-white">{noBetsPlaced ? '—' : formatTokens(gapValue)}</span>
          <span className="mt-px block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">
            {noBetsPlaced ? 'no bets yet' : youLead ? 'clear of 2nd' : isIntermission ? 'off the win' : 'behind the leader'}
          </span>
        </span>
      </div>
    </div>
  );

  const standingsSection = (
    <div className="overflow-hidden rounded-[24px] border border-hairline bg-surface">
      {(members ?? []).map((m: any, i: number) => {
        const isMe = m.user_id === user?.id;
        // Optional position delta when a future data source provides it — keep RPCs unchanged.
        const positionDelta: number | undefined = typeof m.position_delta === 'number' ? m.position_delta : undefined;
        return (
          <Link
            key={m.user_id}
            href={`/groups/${groupId}/members/${m.id}`}
            className={cn(
              'flex items-center gap-2.5 px-4 py-[14px]',
              i > 0 && 'border-t border-hairline',
              isMe && 'bg-canvas'
            )}
          >
            <span className="w-6 shrink-0 font-mono text-[12.5px] font-semibold text-faint">{rankLabel(i)}</span>
            {!group?.is_public && (
              <UserAvatar
                userId={m.user_id}
                nickname={m.nickname}
                avatarUpdatedAt={avatarByUser.get(m.user_id)?.avatar_updated_at}
                avatarPresetKey={avatarByUser.get(m.user_id)?.avatar_preset_key}
                className={cn('h-9 w-9 text-xs', isMe ? 'border border-ink' : 'border border-hairline')}
                fallbackClassName="bg-surface text-muted"
              />
            )}
            <span className="min-w-0 flex-1">
              <Mention nickname={m.nickname} className="block truncate text-[14.5px] font-bold text-ink" />
              {(m.balance === 0 || m.status !== 'active') && (
                <span className="block text-[11.5px] font-semibold text-faint">
                  {m.balance === 0 && 'Broke'}
                  {m.balance === 0 && m.status !== 'active' && ' · '}
                  {m.status === 'dormant' && 'Sitting out'}
                  {m.status === 'left' && 'Left'}
                </span>
              )}
            </span>
            {positionDelta !== undefined && positionDelta !== 0 && (
              <span
                className={cn(
                  'shrink-0 font-mono text-[12.5px] font-semibold',
                  positionDelta > 0 ? 'text-gain' : 'text-alert'
                )}
              >
                {positionDelta > 0 ? `↑${positionDelta}` : `↓${Math.abs(positionDelta)}`}
              </span>
            )}
            <span className="shrink-0 font-mono text-[15px] font-semibold text-ink">{formatTokens(m.balance)}</span>
            <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-faint" />
          </Link>
        );
      })}
      <p className="border-t border-hairline px-4 py-3 text-[11.5px] text-faint">
        {noBetsPlaced
          ? "Nobody's placed a bet yet, so this order doesn't mean anything. It'll shuffle once betting starts."
          : isIntermission
            ? 'Frozen when the season ended. The next season starts everyone level.'
            : 'Sorted by tokens. Your row is shaded.'}
      </p>
    </div>
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

    const [{ data: netRow }, { data: settledBets }, { data: resultsPage }] = await Promise.all([
      myMembership
        ? supabase.from('membership_ledger_net').select('net').eq('membership_id', myMembership.id).maybeSingle()
        : Promise.resolve({ data: null }),
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

    const myNet = Number((netRow as { net: number } | null)?.net ?? 0);
    const correctCount = (settledBets ?? []).filter((b: any) =>
      b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome
    ).length;
    const myAccuracy = (settledBets?.length ?? 0) > 0 ? Math.round((correctCount / settledBets!.length) * 100) : null;

    const hasNextPage = (resultsPage ?? []).length > SEASON_HISTORY_PAGE_SIZE;
    const results = (resultsPage ?? []).slice(0, SEASON_HISTORY_PAGE_SIZE);
    const pageLink = (p: number) => `/groups/${groupId}/leaderboard?lens=alltime&page=${p}`;

    allTimeSection = (
      <div className="space-y-6">
        <Card className="!shadow-none">
          <h2 className="mb-3 text-[17px] font-bold tracking-[-0.01em] text-ink">Your all-time</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={`font-mono text-[26px] font-semibold tracking-tight ${myNet >= 0 ? 'text-gain' : 'text-faint'}`}>
                {myNet >= 0 ? '+' : '−'}
                {formatTokens(Math.abs(myNet))}
              </p>
              <p className="mt-0.5 text-[11.5px] font-semibold text-faint">Net across every season</p>
            </div>
            <div>
              <p className="font-mono text-[26px] font-semibold tracking-tight text-ink">{myAccuracy == null ? '—' : `${myAccuracy}%`}</p>
              <p className="mt-0.5 text-[11.5px] font-semibold text-faint">Accuracy</p>
            </div>
          </div>
        </Card>

        <div>
          <h2 className="mb-3 text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Season history</h2>
          {(results ?? []).length === 0 && page === 1 ? (
            <EmptyState icon="" title="No seasons in the books yet" subtitle="History shows up here once a season ends." />
          ) : (
            <div className="space-y-3">
              {(results ?? []).map((r: any, i: number) => (
                <Card key={i} className="!shadow-none">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-bold text-ink">{r.seasons?.name ?? `Season ${r.seasons?.number}`}</h3>
                    <span className="shrink-0 font-mono text-[11.5px] font-semibold text-faint">
                      {r.seasons?.started_at && formatSeasonDate(r.seasons.started_at)} –{' '}
                      {r.seasons?.ended_at && formatSeasonDate(r.seasons.ended_at)}
                    </span>
                  </div>

                  {r.snapshot.champion && (
                    <div className="mt-3.5 flex items-center gap-3.5 rounded-[18px] border border-hairline px-4 py-3.5">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-ink font-mono text-[15px] font-semibold text-on-ink">
                        1
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Champion</p>
                        <p className="truncate text-[15px] font-bold text-ink">
                          <Mention nickname={r.snapshot.champion.nickname} />
                        </p>
                        <p className="font-mono text-[12.5px] font-semibold text-muted">{formatTokens(r.snapshot.champion.balance)}</p>
                      </div>
                    </div>
                  )}

                  <div className="relative -mx-5 mt-4 border-t border-dashed border-hairline">
                    <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-canvas" />
                    <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-canvas" />
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-4 text-[13.5px]">
                    {r.snapshot.biggest_single_win && (
                      <div>
                        <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Biggest win</p>
                        <p className="mt-0.5 text-muted">
                          <Mention nickname={r.snapshot.biggest_single_win.nickname} />{' '}
                          <span className="font-mono font-semibold text-gain">+{formatTokens(r.snapshot.biggest_single_win.amount)}</span>
                        </p>
                      </div>
                    )}
                    {r.snapshot.worst_beat && (
                      <div>
                        <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Worst beat</p>
                        <p className="mt-0.5 text-muted">
                          <Mention nickname={r.snapshot.worst_beat.nickname} />{' '}
                          <span className="font-mono font-semibold text-faint">−{formatTokens(r.snapshot.worst_beat.amount)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {(page > 1 || hasNextPage) && (
            <div className="mt-4 flex items-center justify-between text-[13.5px] font-semibold">
              {page > 1 ? (
                <Link href={pageLink(page - 1)} className="text-signal hover:text-signal-deep">
                  Newer
                </Link>
              ) : (
                <span />
              )}
              {hasNextPage && (
                <Link href={pageLink(page + 1)} className="text-signal hover:text-signal-deep">
                  Older
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
        action={seasonLine && <span className="shrink-0 text-[11.5px] font-extrabold text-faint">{seasonLine}</span>}
      />

      {hero}

      {settings?.seasons_enabled ? (
        <LeaderboardLenses
          initialLens={lensParam === 'alltime' ? 'alltime' : 'current'}
          currentLabel={isIntermission ? `${endedSeason?.name ?? `Season ${endedSeason?.number ?? ''}`} final` : 'Current standings'}
          current={
            <div className="space-y-3.5">
              <SeasonStakesBand
                groupId={groupId}
                prizeText={settings?.prize_text ?? null}
                punishmentText={settings?.punishment_text ?? null}
                canEdit={canEditStakes}
              />
              {standingsSection}
            </div>
          }
          allTime={allTimeSection}
        />
      ) : (
        <>
          <SeasonStakesBand
            groupId={groupId}
            prizeText={settings?.prize_text ?? null}
            punishmentText={settings?.punishment_text ?? null}
            canEdit={canEditStakes}
          />
          {standingsSection}
        </>
      )}

      {settings?.awards_enabled && (
        <Link
          href={`/groups/${groupId}/awards`}
          className="flex items-center gap-3 rounded-[20px] border border-hairline bg-surface px-3.5 py-3"
        >
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-canvas">
            <AwardGlyph iconKey="target" stroke="var(--color-ink)" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-bold text-ink">Awards</span>
            <span className="mt-0.5 block text-[11.5px] text-faint">
              {yourTitleCount > 0
                ? `You hold ${numberWord(yourTitleCount)} of ${numberWord(TITLE_ORDER.length)} titles`
                : 'See who holds each standing title'}
            </span>
          </span>
          <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-faint" />
        </Link>
      )}
    </main>
  );
}
