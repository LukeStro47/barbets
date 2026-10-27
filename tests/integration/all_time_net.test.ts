import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

// All-time net has to survive a season reset. start_season overwrites balance with the seed and
// writes a fresh seed row, with nothing in the ledger for the leftover it overwrote, so a
// `balance - sum(seeds)` net went down by one seed per extra season (a member who never bet
// showed -1,000 after two seasons). See 20261027120000_all_time_net_across_seasons.sql.

async function membershipId(groupId: string, userId: string): Promise<string> {
  const { data, error } = await adminClient.from('memberships').select('id').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data!.id;
}

describe('all-time net across seasons', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('atnet', ['owner', 'sponsor', 'winner', 'loser', 'idle']);
    group = await setupGroup(users.owner, [users.sponsor, users.winner, users.loser, users.idle], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'manual',
    });

    // Season 1: winner takes loser's 100.
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    const { error: winErr } = await users.winner.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });
    expect(winErr).toBeNull();
    const { error: loseErr } = await users.loser.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 100 });
    expect(loseErr).toBeNull();
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();

    // Season 2 starts, which reseeds everyone back to 1,000.
    const { error: endErr } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
    expect(endErr).toBeNull();
    const { error: startErr } = await users.owner.client.rpc('start_season', { p_group_id: group.id });
    expect(startErr).toBeNull();
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  async function statsNet(userId: string): Promise<number> {
    const { data, error } = await users.owner.client.rpc('get_member_stats', { p_membership_id: await membershipId(group.id, userId) });
    expect(error).toBeNull();
    const row = (Array.isArray(data) ? data[0] : data) as { net: string | number };
    return Number(row.net);
  }

  test('get_member_stats keeps season 1 results and does not charge an extra seed', async () => {
    const winner = await statsNet(users.winner.id);
    const loser = await statsNet(users.loser.id);
    expect(winner).toBeGreaterThan(0);
    expect(loser).toBe(-100);
    expect(await statsNet(users.idle.id)).toBe(0);
    // Tokens only moved between the two bettors, so their nets cancel out.
    expect(winner + loser).toBe(0);
  });

  test('get_group_all_time_standings agrees with get_member_stats', async () => {
    const { data, error } = await users.owner.client.rpc('get_group_all_time_standings', { p_group_id: group.id });
    expect(error).toBeNull();
    const netByUser = new Map((data as { user_id: string; net: string | number }[]).map((r) => [r.user_id, Number(r.net)]));
    expect(netByUser.get(users.winner.id)).toBe(await statsNet(users.winner.id));
    expect(netByUser.get(users.loser.id)).toBe(-100);
    expect(netByUser.get(users.idle.id)).toBe(0);
  });

  test('the helper is not callable directly by a member', async () => {
    const { error } = await users.owner.client.rpc('_membership_all_time_net', {
      p_membership_id: await membershipId(group.id, users.winner.id),
    });
    expect(error).not.toBeNull();
  });
});
