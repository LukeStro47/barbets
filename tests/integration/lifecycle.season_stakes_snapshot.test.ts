import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

/**
 * season_results.snapshot's stakes keys (loser, prize_text, punishment_text). These were added in
 * 20260830240000 and then silently dropped by 20260907220000 redefining _finalize_season from an
 * older copy, with no test to notice; 20261004100000 restored them, 20261004110000 fixed who
 * can be named last, and 20261004120000 made the champion and final table season-scoped (only
 * members who played). This pins all of it.
 */

type Snapshot = {
  champion: { user_id: string } | null;
  loser: { user_id: string } | null;
  prize_text: string | null;
  punishment_text: string | null;
  final_balances: { user_id: string }[];
};

async function setStakes(owner: TestUser, groupId: string) {
  const { error } = await owner.client.rpc('update_group_settings', {
    p_group_id: groupId,
    p_seed_amount: 1000,
    p_seasons_enabled: true,
    p_season_length: 'manual',
    p_timezone: 'UTC',
    p_betting_enabled: true,
    p_accepting_members: true,
    p_season_custom_ends_at: null,
    p_prize_text: 'Picks the next bar',
    p_punishment_text: 'Buys the first round',
  });
  if (error) throw error;
}

async function endAndReadSnapshot(owner: TestUser, groupId: string): Promise<Snapshot> {
  const { error } = await owner.client.rpc('end_season', { p_group_id: groupId });
  if (error) throw error;
  const { data, error: readErr } = await adminClient.from('season_results').select('snapshot').eq('group_id', groupId).single();
  if (readErr) throw readErr;
  return data!.snapshot as Snapshot;
}

describe('season stakes in the snapshot', () => {
  let users: Record<string, TestUser>;

  beforeAll(async () => {
    users = await createTestUsers('stk', ['owner', 'sponsor', 'winner', 'loser', 'sitout', 'richsitout', 'idleowner', 'idlemate']);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('names the prize, the punishment and a last place who actually played', async () => {
    const group: GroupRow = await setupGroup(users.owner, [users.sponsor, users.winner, users.loser, users.sitout, users.richsitout], {
      seasonsEnabled: true,
      seasonLength: 'manual',
    });
    await setStakes(users.owner, group.id);

    // Members who sat the season out are outside it entirely: one carrying a lower balance than
    // anyone who played must not be named last, and one carrying a higher balance must not be
    // crowned champion or ranked in the final table.
    await adminClient.from('memberships').update({ status: 'dormant', balance: 10 }).eq('group_id', group.id).eq('user_id', users.sitout.id);
    await adminClient.from('memberships').update({ status: 'dormant', balance: 5000 }).eq('group_id', group.id).eq('user_id', users.richsitout.id);

    const market = await createMarket(users.owner, group.id);
    expect((await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id })).error).toBeNull();
    expect((await users.winner.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 200 })).error).toBeNull();
    expect((await users.loser.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 300 })).error).toBeNull();
    expect((await users.owner.client.rpc('propose_resolution', { p_market_id: market.id, p_outcome: 'yes' })).error).toBeNull();
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 24);
    expect((await users.owner.client.rpc('finalize_market', { p_market_id: market.id })).error).toBeNull();

    const snap = await endAndReadSnapshot(users.owner, group.id);
    expect(snap.prize_text).toBe('Picks the next bar');
    expect(snap.punishment_text).toBe('Buys the first round');
    expect(snap.champion?.user_id).toBe(users.winner.id);
    expect(snap.loser?.user_id).toBe(users.loser.id);
    const ranked = snap.final_balances.map((r) => r.user_id);
    expect(ranked[0]).toBe(users.winner.id);
    expect(ranked).not.toContain(users.sitout.id);
    expect(ranked).not.toContain(users.richsitout.id);
  });

  test('names nobody last when the season ends level, never the champion', async () => {
    const group: GroupRow = await setupGroup(users.idleowner, [users.idlemate], { seasonsEnabled: true, seasonLength: 'manual' });
    await setStakes(users.idleowner, group.id);

    const snap = await endAndReadSnapshot(users.idleowner, group.id);
    expect(snap.champion).not.toBeNull();
    expect(snap.loser).toBeNull();
    expect(snap.punishment_text).toBe('Buys the first round');
  });
});
