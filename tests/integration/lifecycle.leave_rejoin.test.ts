import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

async function membershipRow(groupId: string, userId: string) {
  const { data, error } = await adminClient
    .from('memberships')
    .select('id, balance, status')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data!;
}

describe('leave then rejoin', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('lrj', ['owner', 'sponsor', 'leaver', 'other']);
    group = await setupGroup(users.owner, [users.sponsor, users.leaver, users.other], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('leave then rejoin mid-season restores the exact prior balance, with no reseed', async () => {
    const before = await membershipRow(group.id, users.leaver.id);
    expect(before.balance).toBe(1000);

    await users.leaver.client.rpc('leave_group', { p_group_id: group.id });
    const dormant = await membershipRow(group.id, users.leaver.id);
    expect(dormant.status).toBe('dormant');
    expect(dormant.balance).toBe(1000);

    const { data: rejoined, error } = await users.leaver.client.rpc('join_group', { p_invite_code: group.invite_code });
    expect(error).toBeNull();
    expect((Array.isArray(rejoined) ? rejoined[0] : rejoined).balance).toBe(1000); // not reseeded

    const after = await membershipRow(group.id, users.leaver.id);
    expect(after.status).toBe('active');
    expect(after.balance).toBe(1000);
  });

  test('leaving with an open bet, then the market resolves: the (dormant) balance receives the correct payout', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 2000);

    const leaverBefore = await membershipRow(group.id, users.leaver.id);
    await users.leaver.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });
    await users.other.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 50 });

    await users.leaver.client.rpc('leave_group', { p_group_id: group.id });
    const dormantMidBet = await membershipRow(group.id, users.leaver.id);
    expect(dormantMidBet.status).toBe('dormant');
    expect(dormantMidBet.balance).toBe(leaverBefore.balance - 100); // stake still out, not refunded by leaving

    await new Promise((r) => setTimeout(r, 2500));
    await adminClient.rpc('expire_stale');
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    await adminClient
      .from('resolution_proposals')
      .update({ proposed_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
      .eq('market_id', market.id);
    const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();

    // leaver bet 100 on the only winning side against other's 50 losing stake -> pool 150, all to leaver
    const leaverAfter = await membershipRow(group.id, users.leaver.id);
    expect(leaverAfter.status).toBe('dormant');
    expect(leaverAfter.balance).toBe(dormantMidBet.balance + 150);
  });

  test('ledger conservation: sum of ledger entries always reconciles the leaver membership balance', async () => {
    const { data: membership } = await adminClient
      .from('memberships')
      .select('id, balance')
      .eq('group_id', group.id)
      .eq('user_id', users.leaver.id)
      .single();
    const { data: entries } = await adminClient.from('ledger').select('amount').eq('membership_id', membership!.id);
    const sum = (entries ?? []).reduce((acc, e) => acc + e.amount, 0);
    expect(sum).toBe(membership!.balance);
  });
});
