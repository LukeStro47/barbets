import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

async function membershipRow(groupId: string, userId: string) {
  const { data, error } = await adminClient.from('memberships').select('*').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data!;
}

async function latestEvent(eventType: string, groupId: string) {
  const { data, error } = await adminClient
    .from('notification_events')
    .select('id, event_type, market_id, actor_id')
    .eq('event_type', eventType)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

describe('void_market_by_creator', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('voidc', ['owner', 'a', 'b']);
    group = await setupGroup(users.owner, [users.a, users.b], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('does not apply when the owner is not a subject, the normal owner kill switch should be used instead', async () => {
    const market = await createMarket(users.a, group.id, { closesInMs: 60000 });
    await users.b.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);

    const { error } = await users.a.client.rpc('void_market_by_creator', { p_market_id: market.id });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('only the market\'s creator can use this fallback, even when the owner is a subject', async () => {
    const market = await createMarket(users.a, group.id, { subjectIds: [users.owner.id], closesInMs: 60000 });
    await users.b.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);

    const { error } = await users.b.client.rpc('void_market_by_creator', { p_market_id: market.id });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('creator voids the market when the owner is a subject: refunds stakes exactly and emits market_voided', async () => {
    const market = await createMarket(users.a, group.id, { subjectIds: [users.owner.id], closesInMs: 60000 });
    await users.b.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 150 });

    const bBefore = await membershipRow(group.id, users.b.id);
    expect(bBefore.balance).toBe(850);

    const { data, error } = await users.a.client.rpc('void_market_by_creator', { p_market_id: market.id });
    expect(error).toBeNull();
    const updated = Array.isArray(data) ? data[0] : data;
    expect(updated.status).toBe('voided');
    expect(updated.outcome).toBe('void');

    const bAfter = await membershipRow(group.id, users.b.id);
    expect(bAfter.balance).toBe(1000);

    const event = await latestEvent('market_voided', group.id);
    expect(event.market_id).toBe(market.id);
    expect(event.actor_id).toBe(users.a.id);
  });

  test('cannot void a market that has already been settled', async () => {
    const market = await createMarket(users.a, group.id, { subjectIds: [users.owner.id], closesInMs: 60000 });
    await users.b.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.a.client.rpc('void_market_by_creator', { p_market_id: market.id });

    const { error } = await users.a.client.rpc('void_market_by_creator', { p_market_id: market.id });
    expect(error?.message).toMatch(/invalid_operation/);
    expect(error?.message).toMatch(/already been settled/);
  });
});
