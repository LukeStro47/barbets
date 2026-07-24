import type { TestUser } from './testUsers';
import { adminClient } from './testUsers';

export interface GroupRow {
  id: string;
  invite_code: string;
  owner_id: string;
}

export interface CreateGroupOptions {
  seedAmount?: number;
  seasonsEnabled?: boolean;
  seasonLength?: '1m' | '2m' | '3m' | 'manual' | 'custom' | null;
  seasonCustomEndsAt?: string | null;
  /** Every season starts with betting paused (a per-season gate, separate from group_settings.betting_enabled) — default true so most tests don't have to know about it. Pass false for tests that specifically exercise the paused state. */
  openSeasonBetting?: boolean;
}

/** owner creates the group; every other listed user joins via invite code. */
export async function setupGroup(
  owner: TestUser,
  members: TestUser[],
  opts: CreateGroupOptions = {}
): Promise<GroupRow> {
  const { data, error } = await owner.client.rpc('create_group', {
    p_name: `Test Group ${Date.now()}`,
    p_seed_amount: opts.seedAmount ?? 1000,
    p_seasons_enabled: opts.seasonsEnabled ?? false,
    p_season_length: opts.seasonLength ?? null,
    p_nickname: owner.tag,
    p_season_custom_ends_at: opts.seasonCustomEndsAt ?? null,
  });
  if (error || !data) throw new Error(`setupGroup: ${error?.message}`);
  const group = (Array.isArray(data) ? data[0] : data) as GroupRow;

  // Betting starts off by default (owner has to flip it on) — tests need
  // markets creatable immediately, so flip it here, re-passing the same
  // settings create_group already applied (this RPC replaces the whole row).
  // For a continuous (non-seasons) group this is the only gate create_market
  // checks. For a seasons-enabled group it no longer matters to
  // create_market at all — the season's own betting_open flag governs
  // instead, opened separately below.
  const { error: settingsErr } = await owner.client.rpc('update_group_settings', {
    p_group_id: group.id,
    p_seed_amount: opts.seedAmount ?? 1000,
    p_seasons_enabled: opts.seasonsEnabled ?? false,
    p_season_length: opts.seasonLength ?? null,
    p_timezone: 'UTC',
    p_betting_enabled: true,
    p_accepting_members: true,
    p_season_custom_ends_at: opts.seasonCustomEndsAt ?? null,
  });
  if (settingsErr) throw new Error(`setupGroup enable betting: ${settingsErr.message}`);

  for (const m of members) {
    const { error: joinErr } = await m.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: m.tag });
    if (joinErr) throw new Error(`setupGroup join (${m.tag}): ${joinErr.message}`);
  }

  if (opts.seasonsEnabled && (opts.openSeasonBetting ?? true)) {
    const { data: season, error: seasonErr } = await owner.client
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .single();
    if (seasonErr || !season) throw new Error(`setupGroup: could not find active season to open betting on: ${seasonErr?.message}`);
    const { error: openErr } = await owner.client.rpc('open_season_betting', { p_season_id: season.id });
    if (openErr) throw new Error(`setupGroup open_season_betting: ${openErr.message}`);
  }

  return group;
}

export interface MarketRow {
  id: string;
  status: string;
  outcome: string | null;
  market_type: string;
}

export interface CreateMarketOptions {
  marketType?: 'yes_no' | 'over_under';
  line?: number | null;
  subjectIds?: string[];
  closesInMs?: number;
}

// sponsor_market() rejects endorsing a market with under 5 minutes left before closes_at
// (supabase/migrations/20260724022042_pending_sponsor_deadline.sql) — every market created
// here always gets a real closes_at with comfortable headroom above that, regardless of
// opts.closesInMs, so sponsoring never races the gate. A test that wants the market to
// actually close soon after sponsoring calls fastForwardCloseTime() right after its own
// sponsor_market call, which backdates closes_at directly via the admin client to simulate
// time having passed — same idea as this suite's existing backdate() helper, just for a
// column sponsor_market itself won't let a normal RPC call set to something imminent.
const SAFE_SPONSOR_WINDOW_MS = 6 * 60_000;

export async function createMarket(
  creator: TestUser,
  groupId: string,
  opts: CreateMarketOptions = {}
): Promise<MarketRow> {
  const closesAt = new Date(Date.now() + Math.max(opts.closesInMs ?? 2000, SAFE_SPONSOR_WINDOW_MS)).toISOString();
  const { data, error } = await creator.client.rpc('create_market', {
    p_group_id: groupId,
    p_title: `Test market ${Date.now()}`,
    p_description: 'Integration test market',
    p_market_type: opts.marketType ?? 'yes_no',
    p_closes_at: closesAt,
    p_line: opts.line ?? null,
    p_subject_user_ids: opts.subjectIds ?? [],
  });
  if (error || !data) throw new Error(`createMarket: ${error?.message}`);
  return (Array.isArray(data) ? data[0] : data) as MarketRow;
}

/** Backdates a sponsored market's closes_at to simulate it actually closing soon (or having
    already closed) — call right after sponsor_market succeeds, passing the same closesInMs
    the test originally wanted at creation. See the note on createMarket() above for why this
    two-step dance exists instead of just passing a short closes_at up front. */
export async function fastForwardCloseTime(marketId: string, closesInMs: number): Promise<void> {
  const { error } = await adminClient
    .from('markets')
    .update({ closes_at: new Date(Date.now() + closesInMs).toISOString() })
    .eq('id', marketId);
  if (error) throw new Error(`fastForwardCloseTime: ${error.message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
