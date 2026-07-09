import type { TestUser } from './testUsers';

export interface GroupRow {
  id: string;
  invite_code: string;
  owner_id: string;
}

export interface CreateGroupOptions {
  seedAmount?: number;
  seasonsEnabled?: boolean;
  seasonLength?: '1m' | '2m' | '3m' | 'manual' | null;
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
  });
  if (error || !data) throw new Error(`setupGroup: ${error?.message}`);
  const group = (Array.isArray(data) ? data[0] : data) as GroupRow;

  // Betting starts off by default (owner has to flip it on) — tests need
  // markets creatable immediately, so flip it here, re-passing the same
  // settings create_group already applied (this RPC replaces the whole row).
  const { error: settingsErr } = await owner.client.rpc('update_group_settings', {
    p_group_id: group.id,
    p_seed_amount: opts.seedAmount ?? 1000,
    p_seasons_enabled: opts.seasonsEnabled ?? false,
    p_season_length: opts.seasonLength ?? null,
    p_timezone: 'UTC',
    p_betting_enabled: true,
    p_accepting_members: true,
  });
  if (settingsErr) throw new Error(`setupGroup enable betting: ${settingsErr.message}`);

  for (const m of members) {
    const { error: joinErr } = await m.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: m.tag });
    if (joinErr) throw new Error(`setupGroup join (${m.tag}): ${joinErr.message}`);
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

export async function createMarket(
  creator: TestUser,
  groupId: string,
  opts: CreateMarketOptions = {}
): Promise<MarketRow> {
  const closesAt = new Date(Date.now() + (opts.closesInMs ?? 2000)).toISOString();
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
