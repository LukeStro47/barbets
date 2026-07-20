import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, backdate, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, sleep, type GroupRow } from './helpers/scenarios';

async function subscribe(user: TestUser) {
  const { error } = await user.client.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: `https://example.com/push/${user.id}`,
    p256dh: 'p256dh',
    auth_key: 'auth-key',
  });
  if (error) throw error;
}

async function latestEvent(eventType: string, groupId: string) {
  const { data, error } = await adminClient
    .from('notification_events')
    .select('id, event_type, market_id, season_id, actor_id')
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

describe('notification event emission', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('nev', ['owner', 'a', 'b', 'subject']);
    group = await setupGroup(users.owner, [users.a, users.b, users.subject]);
    for (const u of [users.owner, users.a, users.b, users.subject]) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('create_market emits market_needs_endorsement, excluding the creator and any subject', async () => {
    const market = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id], closesInMs: 60000 });
    const event = await latestEvent('market_needs_endorsement', group.id);
    expect(event.market_id).toBe(market.id);
    expect(event.actor_id).toBe(users.owner.id);

    const recipients = await recipientIds(event.id);
    expect(recipients).not.toContain(users.owner.id); // actor excluded
    expect(recipients).not.toContain(users.subject.id); // subject excluded
    expect(recipients.sort()).toEqual([users.a.id, users.b.id].sort());
  });

  test('sponsor_market emits market_opened, excluding the endorser', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });

    const event = await latestEvent('market_opened', group.id);
    expect(event.market_id).toBe(market.id);
    expect(event.actor_id).toBe(users.a.id);

    const recipients = await recipientIds(event.id);
    expect(recipients).not.toContain(users.a.id);
    expect(recipients.sort()).toEqual([users.owner.id, users.b.id, users.subject.id].sort());
  });

  test('propose_resolution and challenge_resolution emit their events, excluding the acting user each time', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });
    await sleep(3000);
    await adminClient.rpc('expire_stale');

    const closedEvent = await latestEvent('market_closed', group.id);
    expect(closedEvent.market_id).toBe(market.id);
    expect(closedEvent.actor_id).toBeNull(); // system-triggered, nobody excluded

    await users.a.client.rpc('propose_resolution', { p_market_id: market.id, p_outcome: 'yes', p_justification: null, p_actual_value: null });
    const proposedEvent = await latestEvent('resolution_proposed', group.id);
    expect((await recipientIds(proposedEvent.id))).not.toContain(users.a.id);

    await users.b.client.rpc('challenge_resolution', { p_market_id: market.id, p_reason: null });
    const challengedEvent = await latestEvent('resolution_challenged', group.id);
    expect((await recipientIds(challengedEvent.id))).not.toContain(users.b.id);
  });

  test('market_resolved recipients include the subject (the one exception to subject exclusion)', async () => {
    const market = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id], closesInMs: 2000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });
    await sleep(3000);
    await adminClient.rpc('expire_stale');
    await users.a.client.rpc('propose_resolution', { p_market_id: market.id, p_outcome: 'yes', p_justification: null, p_actual_value: null });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    await adminClient.rpc('finalize_market', { p_market_id: market.id });

    const event = await latestEvent('market_resolved', group.id);
    const recipients = await recipientIds(event.id);
    expect(recipients).toContain(users.subject.id);
    expect(recipients.sort()).toEqual([users.owner.id, users.a.id, users.b.id, users.subject.id].sort());
  });
});

describe('member_joined notifies only the group owner', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('mjn', ['owner', 'a']);
    group = await setupGroup(users.owner, [users.a]);
    await subscribe(users.owner);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a genuinely new member joining emits member_joined, recipients = owner only', async () => {
    const joiner = await createTestUsers('mjn', ['b']);
    try {
      const { error: joinErr } = await joiner.b.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: joiner.b.tag });
      expect(joinErr).toBeNull();

      const event = await latestEvent('member_joined', group.id);
      expect(event.actor_id).toBe(joiner.b.id);
      expect(event.market_id).toBeNull();

      const recipients = await recipientIds(event.id);
      expect(recipients).toEqual([users.owner.id]);
    } finally {
      await cleanupTestUsers(joiner);
    }
  });

  test('a dormant member reactivating (rejoin) does not emit another member_joined event', async () => {
    // `a` leaves (goes dormant), then rejoins — this is a reactivation, not
    // a new membership, so join_group() should not fire a second event.
    await users.a.client.rpc('leave_group', { p_group_id: group.id });

    const { count: before } = await adminClient
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'member_joined')
      .eq('group_id', group.id);

    const { error: rejoinErr } = await users.a.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: users.a.tag });
    expect(rejoinErr).toBeNull();

    const { count: after } = await adminClient
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'member_joined')
      .eq('group_id', group.id);

    expect(after).toBe(before);
  });
});

describe('season_ended notifications reach dormant members too', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('nse', ['owner', 'stays', 'goesdormant']);
    group = await setupGroup(users.owner, [users.stays, users.goesdormant], {
      seasonsEnabled: true,
      seasonLength: 'manual',
    });
    for (const u of [users.owner, users.stays, users.goesdormant]) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a member who opts out (and goes dormant) still receives the season_ended notification', async () => {
    const { error: endErr } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
    expect(endErr).toBeNull();

    const event = await latestEvent('season_ended', group.id);
    expect(event.actor_id).toBe(users.owner.id);

    const { data: intermission } = await adminClient.from('seasons').select('id').eq('group_id', group.id).eq('status', 'intermission').single();
    // stays does nothing — currently-active members are included by default now.
    await users.goesdormant.client.rpc('opt_out_season', { p_season_id: intermission!.id });
    await users.owner.client.rpc('start_season', { p_group_id: group.id });

    const { data: dormantMembership } = await adminClient
      .from('memberships')
      .select('status')
      .eq('group_id', group.id)
      .eq('user_id', users.goesdormant.id)
      .single();
    expect(dormantMembership!.status).toBe('dormant');

    // the season_ended event was emitted BEFORE start_season ran, while
    // goesdormant was still 'active' — recipients should include them and
    // exclude only the owner (the actor).
    const recipients = await recipientIds(event.id);
    expect(recipients).not.toContain(users.owner.id);
    expect(recipients.sort()).toEqual([users.stays.id, users.goesdormant.id].sort());
  });
});
