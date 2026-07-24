import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow, type MarketRow } from './helpers/scenarios';

async function subscribe(user: TestUser) {
  const { error } = await user.client.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: `https://example.com/push/${user.id}`,
    p256dh: 'p256dh',
    auth_key: 'auth-key',
  });
  if (error) throw error;
}

async function recipients(marketId: string, includeSubjects = false): Promise<string[]> {
  const { data, error } = await adminClient.rpc('get_notification_recipients', {
    p_market_id: marketId,
    p_include_subjects: includeSubjects,
  });
  if (error) throw error;
  return (data as { user_id: string }[]).map((r) => r.user_id).sort();
}

describe('push notification fan-out excludes subjects', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let market: MarketRow;

  beforeAll(async () => {
    users = await createTestUsers('ntf', ['owner', 'sponsor', 'subject', 'bettor', 'noSub']);
    group = await setupGroup(users.owner, [users.sponsor, users.subject, users.bettor, users.noSub]);

    // everyone except noSub subscribes to push
    for (const u of [users.owner, users.sponsor, users.subject, users.bettor]) {
      await subscribe(u);
    }

    market = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id] });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 2000);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('default fan-out excludes the subject and anyone without a subscription', async () => {
    const ids = await recipients(market.id, false);
    expect(ids).not.toContain(users.subject.id);
    expect(ids).not.toContain(users.noSub.id);
    expect(ids.sort()).toEqual([users.owner.id, users.sponsor.id, users.bettor.id].sort());
  });

  test('the resolved-event fan-out includes the subject', async () => {
    const ids = await recipients(market.id, true);
    expect(ids).toContain(users.subject.id);
    expect(ids.sort()).toEqual([users.owner.id, users.sponsor.id, users.subject.id, users.bettor.id].sort());
  });

  test('a member with notifications disabled is excluded even with a subscription', async () => {
    await adminClient.from('users').update({ notifications_enabled: false }).eq('id', users.bettor.id);
    const ids = await recipients(market.id, false);
    expect(ids).not.toContain(users.bettor.id);
    await adminClient.from('users').update({ notifications_enabled: true }).eq('id', users.bettor.id);
  });

  test('a dormant member is excluded from fan-out even with a subscription', async () => {
    const { data: m } = await adminClient
      .from('memberships')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', users.bettor.id)
      .single();
    await adminClient.from('memberships').update({ status: 'dormant' }).eq('id', m!.id);

    const ids = await recipients(market.id, false);
    expect(ids).not.toContain(users.bettor.id);

    await adminClient.from('memberships').update({ status: 'active' }).eq('id', m!.id);
  });

  test('get_notification_recipients is not callable by an ordinary authenticated user', async () => {
    const { error } = await users.owner.client.rpc('get_notification_recipients', {
      p_market_id: market.id,
      p_include_subjects: false,
    });
    expect(error).toBeTruthy();
  });
});
