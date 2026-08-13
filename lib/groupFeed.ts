import type { createClient } from '@/lib/supabase/server';
import type { MarketCardData } from '@/components/markets/MarketCard';
import { REACTIONS } from '@/lib/reactions';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Everything the group feed needs to turn `visible_markets` rows into MarketCardData.
 *
 * The rule this module exists to enforce: **no query inside a per-market loop.** Every
 * status bucket needs some per-market extra (a bet count, the odds, a proposed outcome, an
 * option's label), and the obvious way to get it is a lookup inside the `for` loop that
 * builds the cards. That is one round trip per market, run one after another, on a feed that
 * had no upper bound on how many markets it fetched, so a long-running group's hub got
 * linearly slower forever. Instead: fetch the market rows, collect the ids that need each
 * extra, fetch each extra for all of them at once, then build the cards from Maps with no
 * awaits in the loop at all.
 *
 * The settled half is also paged (see getSettledMarkets), because it is the half that grows
 * without limit: open and pending markets are naturally capped by how much a group has going
 * on right now, but resolved ones accumulate for the life of the group.
 */

/** The column list every bucket below is built from. */
const MARKET_COLUMNS =
  'id, title, status, market_type, closes_at, created_at, resolved_at, outcome, outcome_option_id, line, unit';

const ACTIVE_STATUSES = ['pending_sponsor', 'open', 'closed', 'proposed', 'disputed'];
const BETTING_CLOSED_STATUSES = ['closed', 'proposed', 'disputed'];

/** Rows as they come back from visible_markets — untyped by the Supabase client, named here for readability. */
type MarketRow = {
  id: string;
  title: string;
  status: MarketCardData['status'];
  market_type: MarketCardData['marketType'];
  closes_at: string;
  created_at: string;
  resolved_at: string | null;
  outcome: string | null;
  outcome_option_id: string | null;
  line: number | null;
  unit: string | null;
};

type BetRow = { market_id: string; side: string | null; option_id: string | null; amount: number; payout?: number | null };

function baseCard(m: MarketRow, groupId: string): MarketCardData {
  return {
    id: m.id,
    groupId,
    title: m.title,
    status: m.status,
    marketType: m.market_type,
    closesAt: m.closes_at,
    resolvedAt: m.resolved_at,
    outcome: m.outcome,
    line: m.line,
    unit: m.unit,
  };
}

/** Mirrors the DB's own cutoff (see supabase/migrations/*_shorten_sponsor_deadline_to_24h.sql):
    a market stops being endorsable at 24h since creation, or 5 minutes before betting
    would close, whichever comes first. */
function sponsorDeadline(createdAt: string, closesAt: string): string {
  const byAge = new Date(createdAt).getTime() + 24 * 3_600_000;
  const byClose = new Date(closesAt).getTime() - 5 * 60_000;
  return new Date(Math.min(byAge, byClose)).toISOString();
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  return map;
}

/** Distinct, non-null values — the id lists that feed the batched `.in()` lookups. */
function ids<T>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}

// ---------------------------------------------------------------------------
// Active markets (everything except resolved/voided)
// ---------------------------------------------------------------------------

export interface ActiveBuckets {
  pending_sponsor: MarketCardData[];
  open: MarketCardData[];
  /** closed + proposed. */
  awaiting_resolution: MarketCardData[];
  /** disputed. */
  challenged: MarketCardData[];
}

export interface ActiveMarkets {
  buckets: ActiveBuckets;
  /** The viewer's tokens tied up in bets that haven't settled, subtracted from their balance for the feed's "Free to bet" headline. */
  pendingTokens: number;
}

/**
 * Every market in the group that is still live in some sense, bucketed by status, plus the
 * viewer's own exposure (which comes off the same unsettled-bets query the "In play" figure
 * needs, so the two share one round trip).
 *
 * Deliberately not paged: these buckets are bounded by current activity, and hiding an open
 * market behind a "load more" would hide something the viewer can still act on.
 */
export async function getActiveMarkets(supabase: Supabase, groupId: string, userId: string): Promise<ActiveMarkets> {
  const [{ data: markets }, { data: openBetRows }, { data: needsClarificationRows }, { data: mysteryMarkets }] =
    await Promise.all([
      supabase
        .from('visible_markets')
        .select(MARKET_COLUMNS)
        .eq('group_id', groupId)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false }),
      // settled_at IS NULL also covers bets on closed/proposed/disputed markets, which is what
      // "In play" means; only the 'open' bucket below reads the per-market breakdown, so the
      // wider net is harmless there.
      supabase
        .from('bets')
        .select('market_id, side, option_id, amount, markets!inner(group_id)')
        .eq('user_id', userId)
        .eq('markets.group_id', groupId)
        .is('settled_at', null),
      // resolution_clarifications!inner narrows to markets the current user created that have
      // at least one still-open clarification question — every row in that table is
      // currently-pending by construction (answered ones are deleted, not flagged), so plain
      // existence is the pending check.
      supabase.from('markets').select('id, resolution_clarifications!inner(id)').eq('group_id', groupId).eq('creator_id', userId),
      // Markets the viewer is a hidden subject of never appear in visible_markets at all (that's
      // the whole point of it). get_subject_market_pulse_for_group is the one sanctioned crack in
      // that wall, returning just enough to render a "???" teaser row in whichever status bucket
      // it actually belongs to. Never includes pending_sponsor (no real activity yet) or
      // resolved/voided (already fully visible normally).
      supabase.rpc('get_subject_market_pulse_for_group', { p_group_id: groupId }),
    ]);

  const rows: MarketRow[] = markets ?? [];
  const multipleChoiceIds = new Set(rows.filter((m) => m.market_type === 'multiple_choice').map((m) => m.id));
  const openIds = rows.filter((m) => m.status === 'open').map((m) => m.id);
  const bettingClosedIds = rows.filter((m) => BETTING_CLOSED_STATUSES.includes(m.status)).map((m) => m.id);
  const proposalMarketIds = rows.filter((m) => m.status === 'proposed' || m.status === 'disputed').map((m) => m.id);

  const [{ data: proposalRows }, openCountEntries, oddsEntries] = await Promise.all([
    proposalMarketIds.length > 0
      ? supabase.from('resolution_proposals').select('market_id, proposed_outcome, proposed_option_id').in('market_id', proposalMarketIds)
      : { data: [] as { market_id: string; proposed_outcome: string | null; proposed_option_id: string | null }[] },
    // These two are still one round trip per market: get_open_bet_count and get_closed_odds
    // only take a single market id, and giving them array-valued siblings is a migration. What
    // changed is that they all go out at once instead of one-at-a-time inside the card loop, so
    // the wait is the slowest call rather than the sum of every call.
    Promise.all(
      openIds.map(async (id) => {
        const { data } = await supabase.rpc('get_open_bet_count', { p_market_id: id });
        return [id, (data as number | null) ?? 0] as const;
      })
    ),
    Promise.all(
      bettingClosedIds.map(async (id) => {
        const fn = multipleChoiceIds.has(id) ? 'get_closed_odds_options' : 'get_closed_odds';
        const { data } = await supabase.rpc(fn, { p_market_id: id });
        return [id, (data ?? []) as { side?: string; option_id?: string; label?: string; pool_percent: number; bet_count: number }[]] as const;
      })
    ),
  ]);

  // One lookup for every option label the whole feed needs: the proposed outcome of a
  // multiple-choice market awaiting resolution, and the option behind each of the viewer's own
  // open bets.
  const optionIds = ids([
    ...(proposalRows ?? []).map((p) => p.proposed_option_id),
    ...((openBetRows ?? []) as BetRow[]).map((b) => b.option_id),
  ]);
  const { data: optionRows } =
    optionIds.length > 0 ? await supabase.from('market_options').select('id, label').in('id', optionIds) : { data: [] as { id: string; label: string }[] };

  const optionLabelById = new Map((optionRows ?? []).map((o) => [o.id, o.label]));
  const proposalByMarket = new Map((proposalRows ?? []).map((p) => [p.market_id, p]));
  const openCountByMarket = new Map(openCountEntries);
  const oddsByMarket = new Map(oddsEntries);
  const needsClarificationIds = new Set((needsClarificationRows ?? []).map((m: { id: string }) => m.id));
  const myOpenBetsByMarket = groupBy((openBetRows ?? []) as BetRow[], (b) => b.market_id);
  const pendingTokens = ((openBetRows ?? []) as BetRow[]).reduce((sum, b) => sum + b.amount, 0);

  const buckets: ActiveBuckets = { pending_sponsor: [], open: [], awaiting_resolution: [], challenged: [] };

  for (const m of rows) {
    const base = baseCard(m, groupId);

    if (m.status === 'pending_sponsor') {
      buckets.pending_sponsor.push({ ...base, sponsorDeadline: sponsorDeadline(m.created_at, m.closes_at) });
      continue;
    }

    if (m.status === 'open') {
      const myBets = myOpenBetsByMarket.get(m.id)?.map((b) => ({
        label: b.side ? b.side.toUpperCase() : (optionLabelById.get(b.option_id!) ?? '?'),
        amount: b.amount,
      }));
      buckets.open.push({
        ...base,
        openBetCount: openCountByMarket.get(m.id) ?? 0,
        needsAttention: needsClarificationIds.has(m.id),
        myBets,
      });
      continue;
    }

    const bucket = m.status === 'disputed' ? buckets.challenged : buckets.awaiting_resolution;
    const proposal = proposalByMarket.get(m.id);
    const proposedOutcomeLabel = proposal?.proposed_option_id
      ? optionLabelById.get(proposal.proposed_option_id)
      : (proposal?.proposed_outcome ?? undefined);

    const odds = oddsByMarket.get(m.id) ?? [];
    const closedBetCount = odds.reduce((sum, o) => sum + o.bet_count, 0);

    if (m.market_type === 'multiple_choice') {
      bucket.push({
        ...base,
        closedBetCount,
        optionOdds: odds.map((o) => ({ id: o.option_id!, label: o.label!, percent: o.pool_percent })),
        proposedOutcomeLabel,
      });
    } else {
      bucket.push({
        ...base,
        closedBetCount,
        odds: odds.map((o) => ({ side: o.side!, percent: o.pool_percent })),
        proposedOutcomeLabel,
      });
    }
  }

  const MYSTERY_BUCKET: Record<string, keyof ActiveBuckets> = {
    open: 'open',
    closed: 'awaiting_resolution',
    proposed: 'awaiting_resolution',
    disputed: 'challenged',
  };
  for (const m of mysteryMarkets ?? []) {
    const bucketKey = MYSTERY_BUCKET[m.status];
    if (!bucketKey) continue;
    buckets[bucketKey].push({
      id: m.market_id,
      groupId,
      title: '???',
      status: m.status,
      marketType: m.market_type,
      closesAt: m.closes_at,
      outcome: null,
      mystery: true,
      ...(m.status === 'open' ? { openBetCount: Number(m.bet_count) } : { closedBetCount: Number(m.bet_count) }),
    });
  }

  return { buckets, pendingTokens };
}

// ---------------------------------------------------------------------------
// Settled markets (resolved/voided) — the paged half
// ---------------------------------------------------------------------------

export const SETTLED_PAGE_SIZE = 20;

export interface SettledCursor {
  /**
   * resolved_at of the last row on the page just rendered, verbatim as Postgres returned it.
   * Never round-trip this through a JS Date: timestamptz keeps microseconds and Date only
   * keeps milliseconds, so re-serializing would move the boundary and silently skip rows.
   */
  resolvedAt: string;
  id: string;
}

export interface SettledPage {
  markets: MarketCardData[];
  /** Hand back to getSettledMarkets for the next page; null once the list is exhausted. */
  nextCursor: SettledCursor | null;
}

const EMPTY_PAGE: SettledPage = { markets: [], nextCursor: null };

// A cursor comes back in from the client through a Server Action and both halves get
// interpolated into a PostgREST filter string, so they are pattern-checked rather than
// trusted. Anything that isn't exactly a timestamptz / a uuid is treated as "no more pages".
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One page of the group's settled (resolved/voided) markets, newest first, with the viewer's
 * own net on each and its reaction facepile.
 *
 * Keyset paged rather than offset paged: a market resolving while someone is reading pushes
 * every later row down by one, which an OFFSET would turn into a duplicated or skipped card.
 * The cursor is (resolved_at, id) rather than resolved_at alone because a season-end sweep
 * voids every still-open market in a single transaction, and now() is per-transaction, so a
 * couple of dozen rows can share the exact same resolved_at.
 */
export async function getSettledMarkets(
  supabase: Supabase,
  groupId: string,
  userId: string,
  cursor: SettledCursor | null = null
): Promise<SettledPage> {
  if (cursor && (!TIMESTAMP_RE.test(cursor.resolvedAt) || !UUID_RE.test(cursor.id))) return EMPTY_PAGE;

  let query = supabase
    .from('visible_markets')
    .select(MARKET_COLUMNS)
    .eq('group_id', groupId)
    .in('status', ['resolved', 'voided'])
    // Ordered in SQL, not sorted in JS after the fact: a page boundary only holds if the
    // database and the cursor agree on the order. resolved_at is non-null for both statuses
    // by check constraint (markets_terminal_requires_resolved_at).
    .order('resolved_at', { ascending: false })
    .order('id', { ascending: false })
    // The extra row is the "is there another page" probe, dropped before returning.
    .limit(SETTLED_PAGE_SIZE + 1);

  if (cursor) {
    query = query.or(`resolved_at.lt."${cursor.resolvedAt}",and(resolved_at.eq."${cursor.resolvedAt}",id.lt.${cursor.id})`);
  }

  const { data } = await query;
  const rows: MarketRow[] = data ?? [];
  const hasMore = rows.length > SETTLED_PAGE_SIZE;
  const page = rows.slice(0, SETTLED_PAGE_SIZE);
  if (page.length === 0) return EMPTY_PAGE;

  const marketIds = page.map((m) => m.id);
  const optionIds = ids(page.map((m) => m.outcome_option_id));

  const [{ data: reactionRows }, { data: myBetRows }, { data: optionRows }] = await Promise.all([
    supabase.from('market_reactions').select('market_id, emoji').in('market_id', marketIds),
    // The viewer's own bets on every market on this page, so each row can show "+N won" /
    // "-N lost" instead of the bare outcome. Same shape as the reveal page's per-bet query,
    // scoped to one user across many markets instead of every user on one market.
    supabase.from('bets').select('market_id, side, option_id, amount, payout').eq('user_id', userId).in('market_id', marketIds),
    optionIds.length > 0 ? supabase.from('market_options').select('id, label').in('id', optionIds) : { data: [] as { id: string; label: string }[] },
  ]);

  const emojisByMarket = groupBy((reactionRows ?? []) as { market_id: string; emoji: string }[], (r) => r.market_id);
  const myBetsByMarket = groupBy((myBetRows ?? []) as BetRow[], (b) => b.market_id);
  const optionLabelById = new Map((optionRows ?? []).map((o) => [o.id, o.label]));

  const markets = page.map((m) => {
    const emojis = emojisByMarket.get(m.id);
    const isMultipleChoice = m.market_type === 'multiple_choice';
    return {
      ...baseCard(m, groupId),
      outcomeLabel: isMultipleChoice && m.outcome_option_id ? (optionLabelById.get(m.outcome_option_id) ?? null) : undefined,
      reactionGlyphs: emojis ? REACTIONS.filter((r) => emojis.some((e) => e.emoji === r.emoji)).map((r) => r.glyph) : undefined,
      myNet: myNet(m, myBetsByMarket.get(m.id)),
    };
  });

  const last = page[page.length - 1];
  return { markets, nextCursor: hasMore && last.resolved_at ? { resolvedAt: last.resolved_at, id: last.id } : null };
}

/**
 * The viewer's total payout minus total stake on one settled market, summed across every bet
 * they placed (so a hedge nets out the same way the "Resolved" push copy does). Undefined when
 * they never bet on it at all, so the card knows to render nothing rather than "+0 won".
 */
function myNet(m: MarketRow, bets: BetRow[] | undefined): number | undefined {
  if (!bets || bets.length === 0) return undefined;
  const isMultipleChoice = m.market_type === 'multiple_choice';
  const staked = bets.reduce((sum, b) => sum + b.amount, 0);
  const payout = bets.reduce((sum, b) => {
    const isWinner = isMultipleChoice ? b.option_id === m.outcome_option_id : b.side === m.outcome;
    return sum + (isWinner ? (b.payout ?? 0) : 0);
  }, 0);
  return payout - staked;
}
