import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

async function subscribe(user: TestUser) {
  const { error } = await user.client.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: `https://example.com/push/${user.id}`,
    p256dh: 'p256dh',
    auth_key: 'auth-key',
  });
  if (error) throw error;
}

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

async function recipientIds(eventId: string): Promise<string[]> {
  const { data, error } = await adminClient.rpc('get_event_recipients', { p_event_id: eventId });
  if (error) throw error;
  return (data as { user_id: string }[]).map((r) => r.user_id).sort();
}

describe('void_market_by_owner', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('void', ['owner', 'sponsor', 'a', 'b', 'subject']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.subject], { seedAmount: 1000 });
    for (const u of [users.owner, users.sponsor, users.a, users.b, users.subject]) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a non-owner cannot void a market', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);

    const { error } = await users.a.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('the owner voiding refunds every stake exactly and emits market_voided, not market_resolved', async () => {
    const market = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id], closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 200 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 75 });

    const aBefore = await membershipRow(group.id, users.a.id);
    const bBefore = await membershipRow(group.id, users.b.id);
    expect(aBefore.balance).toBe(800);
    expect(bBefore.balance).toBe(925);

    const { data, error } = await users.owner.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error).toBeNull();
    const updated = Array.isArray(data) ? data[0] : data;
    expect(updated.status).toBe('voided');
    expect(updated.outcome).toBe('void');

    const aAfter = await membershipRow(group.id, users.a.id);
    const bAfter = await membershipRow(group.id, users.b.id);
    expect(aAfter.balance).toBe(1000);
    expect(bAfter.balance).toBe(1000);

    const { data: bets } = await adminClient.from('bets').select('payout, settled_at').eq('market_id', market.id);
    for (const b of bets ?? []) {
      expect(b.settled_at).not.toBeNull();
      expect(b.payout).toBeGreaterThan(0); // full refund, not a zeroed loss
    }

    // Should never have emitted a market_resolved event for this market —
    // the whole point is a distinct notification, not the generic one.
    const { data: resolvedEvents } = await adminClient
      .from('notification_events')
      .select('id')
      .eq('event_type', 'market_resolved')
      .eq('market_id', market.id);
    expect(resolvedEvents).toEqual([]);

    const event = await latestEvent('market_voided', group.id);
    expect(event.market_id).toBe(market.id);
    expect(event.actor_id).toBe(users.owner.id);

    // Subjects are included (privacy lifts on void, same as resolve), the
    // acting owner is excluded (they already know what they just did).
    const recipients = await recipientIds(event.id);
    expect(recipients).not.toContain(users.owner.id);
    expect(recipients).toContain(users.subject.id);
    expect(recipients.sort()).toEqual([users.sponsor.id, users.a.id, users.b.id, users.subject.id].sort());
  });

  test('cannot void a market that has already been settled', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.owner.client.rpc('void_market_by_owner', { p_market_id: market.id });

    const { error } = await users.owner.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error?.message).toMatch(/invalid_operation/);
    expect(error?.message).toMatch(/already been settled/);
  });

  test('an owner who is the market\'s subject gets a 404, not a 403', async () => {
    const market = await createMarket(users.sponsor, group.id, { subjectIds: [users.owner.id], closesInMs: 60000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);

    const { error } = await users.owner.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error?.message).toMatch(/not_found/);
  });
});
