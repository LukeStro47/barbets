import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

async function seasonRow(groupId: string, status: string) {
  const { data, error } = await adminClient.from('seasons').select('*').eq('group_id', groupId).eq('status', status).single();
  if (error) throw error;
  return data!;
}

describe('season wind-down: in-flight markets get a grace window instead of instant voiding', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let untouchedMarketId: string;
  let inFlightMarketId: string;

  beforeAll(async () => {
    users = await createTestUsers('wd', ['owner', 'sponsor', 'bettor']);
    group = await setupGroup(users.owner, [users.sponsor, users.bettor], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'manual',
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('end_season force-voids a market with no resolution proposed, but leaves a proposed one alone', async () => {
    const neverProposed = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: neverProposed.id });
    await fastForwardCloseTime(neverProposed.id, 60000);
    untouchedMarketId = neverProposed.id;

    const proposed = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: proposed.id });
    await fastForwardCloseTime(proposed.id, 60000);
    await users.bettor.client.rpc('place_bet', { p_market_id: proposed.id, p_side: 'yes', p_amount: 50 });
    const { error: proposeErr } = await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: proposed.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(proposeErr).toBeNull();
    inFlightMarketId = proposed.id;

    const { error: endErr } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
    expect(endErr).toBeNull();

    const { data: never } = await adminClient.from('markets').select('status').eq('id', untouchedMarketId).single();
    expect(never!.status).toBe('voided');

    const { data: inFlight } = await adminClient.from('markets').select('status').eq('id', inFlightMarketId).single();
    expect(inFlight!.status).toBe('proposed'); // left alone, not force-voided

    const season = await seasonRow(group.id, 'winding_down');
    expect(season.wind_down_deadline).not.toBeNull();

    // no next season row yet, no snapshot yet — the season isn't fully
    // archived while something's still in flight
    const { data: results } = await adminClient.from('season_results').select('id').eq('season_id', season.id);
    expect(results).toEqual([]);
  });

  test('finalizing the last in-flight market archives the season immediately, without a separate call', async () => {
    await backdate('resolution_proposals', 'market_id', inFlightMarketId, 'proposed_at', 9);

    const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: inFlightMarketId });
    expect(finalizeErr).toBeNull();

    const { data: market } = await adminClient.from('markets').select('status').eq('id', inFlightMarketId).single();
    expect(market!.status).toBe('resolved');

    const archived = await seasonRow(group.id, 'archived');
    const { data: results } = await adminClient.from('season_results').select('snapshot').eq('season_id', archived.id).single();
    expect(results!.snapshot.champion).toBeTruthy();

    const { data: intermission } = await adminClient.from('seasons').select('id').eq('group_id', group.id).eq('status', 'intermission').single();
    expect(intermission).toBeTruthy();
  });

  test('create_market is rejected with the standard between-seasons error once winding down', async () => {
    // Re-derive a fresh winding_down state on a second group so this
    // assertion isn't racing the first group's now-archived season.
    const users2 = await createTestUsers('wd2', ['owner', 'sponsor']);
    try {
      const group2 = await setupGroup(users2.owner, [users2.sponsor], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
      const market = await createMarket(users2.owner, group2.id, { closesInMs: 60000 });
      await users2.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 60000);
      await users2.sponsor.client.rpc('propose_resolution', {
        p_market_id: market.id,
        p_outcome: 'yes',
        p_justification: null,
        p_actual_value: null,
      });
      await users2.owner.client.rpc('end_season', { p_group_id: group2.id });

      const { error } = await users2.owner.client.rpc('create_market', {
        p_group_id: group2.id,
        p_title: 'should not be creatable mid-wind-down',
        p_description: 'x',
        p_market_type: 'yes_no',
        p_closes_at: new Date(Date.now() + 60000).toISOString(),
        p_line: null,
        p_subject_user_ids: [],
      });
      expect(error?.message).toMatch(/between seasons/);
    } finally {
      await cleanupTestUsers(users2);
    }
  });
});

describe('season wind-down: hard cap forces stuck markets closed', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('wdc', ['owner', 'sponsor']);
    group = await setupGroup(users.owner, [users.sponsor], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('expire_stale force-voids anything still in flight once wind_down_deadline passes, and archives the season', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });

    await users.owner.client.rpc('end_season', { p_group_id: group.id });
    const winding = await seasonRow(group.id, 'winding_down');

    // Still well within its own 8h challenge window — only the season's
    // wind-down deadline is stale, so this proves the hard cap (not the
    // ordinary proposal timer) is what forces it closed.
    await backdate('seasons', 'id', winding.id, 'wind_down_deadline', 1);

    const { error } = await adminClient.rpc('expire_stale');
    expect(error).toBeNull();

    const { data: marketAfter } = await adminClient.from('markets').select('status').eq('id', market.id).single();
    expect(marketAfter!.status).toBe('voided');

    const { data: seasonAfter } = await adminClient.from('seasons').select('status').eq('id', winding.id).single();
    expect(seasonAfter!.status).toBe('archived');
  });
});
