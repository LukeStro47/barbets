import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, sleep, type GroupRow } from './helpers/scenarios';

async function toDisputed(proposer: TestUser, challenger: TestUser, groupId: string) {
  const market = await createMarket(proposer, groupId, { closesInMs: 2000 });
  await challenger.client.rpc('sponsor_market', { p_market_id: market.id });
  await sleep(3000);
  await adminClient.rpc('expire_stale');
  await proposer.client.rpc('propose_resolution', {
    p_market_id: market.id,
    p_outcome: 'yes',
    p_justification: null,
    p_actual_value: null,
  });
  await challenger.client.rpc('challenge_resolution', { p_market_id: market.id, p_reason: null });
  return market;
}

describe('voting: full turnout and explicit VOID', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('vote', ['owner', 'a', 'b', 'c']);
    group = await setupGroup(users.owner, [users.a, users.b, users.c]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('finalizes immediately once every eligible member has voted, without waiting 48h', async () => {
    const market = await toDisputed(users.owner, users.a, group.id);

    await users.owner.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    await users.a.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    await users.b.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    // last eligible voter (c) — this vote should trigger finalize on its own,
    // long before the 48h window would otherwise elapse
    const { error } = await users.c.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    expect(error).toBeNull();

    const { data: after } = await adminClient.from('markets').select('status, outcome').eq('id', market.id).single();
    expect(after!.status).toBe('resolved');
    expect(after!.outcome).toBe('yes');
  });

  test('an explicit VOID majority resolves the market as voided', async () => {
    const market = await toDisputed(users.owner, users.a, group.id);

    await users.owner.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'void' });
    await users.a.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'void' });
    await users.b.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'void' });
    await users.c.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'no' });

    const { data: after } = await adminClient.from('markets').select('status, outcome').eq('id', market.id).single();
    expect(after!.status).toBe('voided');
    expect(after!.outcome).toBe('void');
  });

  test('a genuine tie (not full turnout) still requires the 24h window, and upholds the proposal when it is among the tied leaders', async () => {
    // only 2 of 4 eligible voters vote, tied 1-1 between the proposed outcome
    // ('yes') and 'no' — must NOT auto-finalize early, and once the window
    // elapses, the proposal (being among the tied leaders) should win rather
    // than voiding.
    const market = await toDisputed(users.owner, users.a, group.id);
    await users.owner.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    await users.a.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'no' });

    const { data: stillDisputed } = await adminClient.from('markets').select('status').eq('id', market.id).single();
    expect(stillDisputed!.status).toBe('disputed');

    await backdate('challenges', 'market_id', market.id, 'created_at', 25);
    const { data: finalized } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    const row = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(row.status).toBe('resolved');
    expect(row.outcome).toBe('yes');
  });

  test('a tie that excludes the proposed outcome still resolves VOID', async () => {
    // proposal is 'yes'; the tie is between 'no' and 'void', neither of
    // which is the proposal — the group disagreed with the proposal but
    // couldn't agree on an alternative, so refund is the honest outcome.
    const market = await toDisputed(users.owner, users.a, group.id);
    await users.owner.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'no' });
    await users.a.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'void' });

    await backdate('challenges', 'market_id', market.id, 'created_at', 25);
    const { data: finalized } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    const row = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(row.status).toBe('voided');
    expect(row.outcome).toBe('void');
  });

  test('zero turnout resolves to the proposed outcome instead of voiding', async () => {
    const market = await toDisputed(users.owner, users.a, group.id);

    await backdate('challenges', 'market_id', market.id, 'created_at', 25);
    const { data: finalized } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    const row = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(row.status).toBe('resolved');
    expect(row.outcome).toBe('yes');
  });
});
