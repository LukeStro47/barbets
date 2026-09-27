import type { createClient } from '@/lib/supabase/server';
import { TITLE_META, TITLE_ORDER, type TitleKey } from '@/lib/titles';
import { diffTitleSnapshots, type TitleSnapshotEntry } from '@/lib/seasonTitleDiff';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface SeasonOverRow {
  user_id: string;
  nickname: string;
  balance: number;
}

export interface SeasonOverAward {
  key: TitleKey;
  label: string;
  iconKey: string;
  stat: string;
  description: string;
  holderUserId: string;
  holderNickname: string;
}

export interface SeasonOverData {
  season: { id: string; number: number; name: string; startedAt: string; endedAt: string | null };
  /** Every archived season, newest first, for the switcher chips. */
  seasons: { number: number; label: string }[];
  marketsSettled: number;
  champion: (SeasonOverRow & { accuracy: number | null }) | null;
  loserNickname: string | null;
  prizeText: string | null;
  punishmentText: string | null;
  finalBalances: SeasonOverRow[];
  seedAmount: number;
  you: { rank: number; of: number; net: number; bets: number; accuracy: number | null; bestCall: number | null } | null;
  /** Titles as the season closed (its titles_snapshot) — the viewer's own first. */
  awards: SeasonOverAward[];
  lostTitles: { label: string; iconKey: string; toNickname: string }[];
}

/**
 * Everything 5n draws for one ended season, read from that season's frozen `season_results`
 * snapshot plus the viewer's own bets in it. Shared by the group hub's intermission branch (the
 * season that just ended) and `/recap?season=N` (any earlier one), so the two can't drift.
 * Returns null when the season has no snapshot (it hasn't ended, or doesn't exist).
 */
export async function loadSeasonOver(supabase: Supabase, groupId: string, userId: string, seasonNumber?: number): Promise<SeasonOverData | null> {
  const [{ data: archived }, { data: settings }, { data: currentTitles }] = await Promise.all([
    supabase
      .from('seasons')
      .select('id, number, name, started_at, ended_at, seed_amount')
      .eq('group_id', groupId)
      .eq('status', 'archived')
      .order('number', { ascending: false }),
    supabase.from('group_settings').select('seed_amount').eq('group_id', groupId).single(),
    supabase.from('group_titles').select('title_key, label, icon_key').eq('group_id', groupId),
  ]);
  const seasonsList = archived ?? [];
  const season = seasonNumber != null ? seasonsList.find((s) => s.number === seasonNumber) : seasonsList[0];
  if (!season) return null;

  const { data: result } = await supabase.from('season_results').select('snapshot').eq('season_id', season.id).maybeSingle();
  if (!result) return null;
  const snap = result.snapshot as {
    champion: SeasonOverRow | null;
    loser: SeasonOverRow | null;
    prize_text: string | null;
    punishment_text: string | null;
    final_balances: SeasonOverRow[];
    markets_settled: number;
    titles_snapshot: TitleSnapshotEntry[];
  };

  const { data: prior } =
    season.number > 1
      ? await supabase.from('season_results').select('snapshot, seasons!inner(number)').eq('group_id', groupId).eq('seasons.number', season.number - 1).maybeSingle()
      : { data: null };
  const priorTitles = (prior?.snapshot as { titles_snapshot?: TitleSnapshotEntry[] } | undefined)?.titles_snapshot ?? null;

  // Every resolved bet this season, for the champion's accuracy and the viewer's own numbers.
  // Other members' bets are readable once their market has resolved.
  const { data: seasonBets } = await supabase
    .from('bets')
    .select('user_id, market_id, side, option_id, amount, payout, markets!inner(season_id, status, outcome, outcome_option_id)')
    .eq('markets.season_id', season.id);
  type Bet = {
    user_id: string;
    market_id: string;
    side: string | null;
    option_id: string | null;
    amount: number;
    payout: number | null;
    markets: { status: string; outcome: string | null; outcome_option_id: string | null };
  };
  const bets = (seasonBets ?? []) as unknown as Bet[];
  const won = (b: Bet) => (b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome);
  const accuracyOf = (uid: string) => {
    const resolved = bets.filter((b) => b.user_id === uid && b.markets.status === 'resolved');
    return resolved.length > 0 ? Math.round((resolved.filter(won).length / resolved.length) * 100) : null;
  };

  const finalBalances = snap.final_balances ?? [];
  const seed = season.seed_amount ?? settings?.seed_amount ?? 0;
  const myIndex = finalBalances.findIndex((r) => r.user_id === userId);
  const myBets = bets.filter((b) => b.user_id === userId);
  const bestCall = myBets
    .filter((b) => b.markets.status === 'resolved' && won(b))
    .reduce<number | null>((best, b) => Math.max(best ?? 0, (b.payout ?? 0) - b.amount), null);

  const labelFor = (key: TitleKey) => {
    const row = (currentTitles ?? []).find((t) => t.title_key === key);
    return { label: row?.label ?? TITLE_META[key].label, iconKey: row?.icon_key ?? TITLE_META[key].defaultIconKey };
  };
  const awards: SeasonOverAward[] = TITLE_ORDER.flatMap((key) => {
    const entry = (snap.titles_snapshot ?? []).find((t) => t.title_key === key);
    if (!entry?.user_id) return [];
    return [
      {
        key,
        ...labelFor(key),
        stat: TITLE_META[key].format(entry.stat_value),
        description: TITLE_META[key].description,
        holderUserId: entry.user_id,
        holderNickname: entry.nickname ?? '',
      },
    ];
  }).sort((a, b) => (a.holderUserId === userId ? -1 : 0) - (b.holderUserId === userId ? -1 : 0));

  const lostTitles = diffTitleSnapshots(snap.titles_snapshot ?? [], priorTitles)
    .filter((c) => c.fromUserId === userId)
    .map((c) => ({ ...labelFor(c.titleKey), toNickname: c.toNickname }));

  return {
    season: {
      id: season.id,
      number: season.number,
      name: season.name ?? `Season ${season.number}`,
      startedAt: season.started_at,
      endedAt: season.ended_at,
    },
    seasons: seasonsList.map((s) => ({ number: s.number, label: s.name ?? `Season ${s.number}` })),
    marketsSettled: snap.markets_settled ?? 0,
    champion: snap.champion ? { ...snap.champion, accuracy: accuracyOf(snap.champion.user_id) } : null,
    loserNickname: snap.loser?.nickname ?? null,
    prizeText: snap.prize_text,
    punishmentText: snap.punishment_text,
    finalBalances,
    seedAmount: seed,
    you:
      myIndex >= 0
        ? {
            rank: myIndex + 1,
            of: finalBalances.length,
            net: finalBalances[myIndex].balance - seed,
            bets: new Set(myBets.map((b) => b.market_id)).size,
            accuracy: accuracyOf(userId),
            bestCall,
          }
        : null,
    awards,
    lostTitles,
  };
}
