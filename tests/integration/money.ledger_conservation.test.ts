import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, sleep, type GroupRow } from './helpers/scenarios';

async function ledgerSum(membershipId: string): Promise<number> {
  const { data, error } = await adminClient.from('ledger').select('amount').eq('membership_id', membershipId);
  if (error) throw error;
  return data!.reduce((s, r: any) => s + r.amount, 0);
}

async function membershipRow(groupId: string, userId: string) {
  const { data, error } = await adminClient
    .from('memberships')
    .select('id, balance')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data!;
}

describe('ledger conservation', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('lgr', ['owner', 'sponsor', 'a', 'b']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b], { seedAmount: 500 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a fresh membership balance equals the sum of its ledger entries (the seed)', async () => {
    const m = await membershipRow(group.id, users.a.id);
    const sum = await ledgerSum(m.id);
    expect(sum).toBe(m.balance);
    expect(m.balance).toBe(500);
  });

  test('balance == sum(ledger) still holds after a bet is placed and settled', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 500 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 500);
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 50 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 30 });

    await sleep(2200);
    await adminClient.rpc('expire_stale');
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    await adminClient.rpc('finalize_market', { p_market_id: market.id });

    for (const u of [users.a, users.b]) {
      const m = await membershipRow(group.id, u.id);
      const sum = await ledgerSum(m.id);
      expect(sum, `${u.tag}: balance must equal sum(ledger)`).toBe(m.balance);
    }
  });

  test('a bet is capped only by your current balance, with no percentage limit', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);

    const m = await membershipRow(group.id, users.a.id);
    const { error: overBalanceErr } = await users.a.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: 'yes',
      p_amount: m.balance + 1,
    });
    expect(overBalanceErr?.message).toMatch(/invalid_operation/);

    const { error: fullBalanceErr } = await users.a.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: 'yes',
      p_amount: m.balance,
    });
    expect(fullBalanceErr).toBeNull();

    const { error: nothingLeftErr } = await users.a.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: 'yes',
      p_amount: 1,
    });
    expect(nothingLeftErr?.message).toMatch(/insufficient_balance/);
  });

  test('minimum bet of 1 is always allowed', async () => {
    const lowRoller = await createTestUsers('lowr', ['x']);
    try {
      await lowRoller.x.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'lowr' });
      const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 60000);

      const m = await membershipRow(group.id, lowRoller.x.id);
      await adminClient.from('memberships').update({ balance: 3 }).eq('id', m.id);

      const { error } = await lowRoller.x.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 1 });
      expect(error).toBeNull();
    } finally {
      await cleanupTestUsers(lowRoller);
    }
  });
});
