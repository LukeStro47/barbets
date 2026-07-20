import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

describe('a group abandoned in intermission gets scheduled for deletion, same as delete_group', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let intermissionSeasonId: string;

  beforeAll(async () => {
    users = await createTestUsers('iex', ['owner', 'other']);
    group = await setupGroup(users.owner, [users.other], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
    await users.owner.client.rpc('end_season', { p_group_id: group.id });

    const { data: intermission } = await adminClient.from('seasons').select('id').eq('group_id', group.id).eq('status', 'intermission').single();
    intermissionSeasonId = intermission!.id;
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('expire_stale schedules deletion once intermission is 30+ days old, with honest copy on the event', async () => {
    await backdate('seasons', 'id', intermissionSeasonId, 'started_at', 31 * 24);

    const { error } = await adminClient.rpc('expire_stale');
    expect(error).toBeNull();

    const { data: groupRow } = await adminClient.from('groups').select('deletion_scheduled_at').eq('id', group.id).single();
    expect(groupRow!.deletion_scheduled_at).not.toBeNull();
    const daysOut = (new Date(groupRow!.deletion_scheduled_at!).getTime() - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(4.9);
    expect(daysOut).toBeLessThan(5.1);

    const { data: event } = await adminClient
      .from('notification_events')
      .select('event_type, actor_id')
      .eq('group_id', group.id)
      .eq('event_type', 'group_deletion_scheduled_inactivity')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(event).toBeTruthy();
    expect(event!.actor_id).toBeNull(); // nobody did this, it's the point of the distinct copy

    // running the sweep again must not re-schedule or duplicate the event
    await adminClient.rpc('expire_stale');
    const { data: events } = await adminClient
      .from('notification_events')
      .select('id')
      .eq('group_id', group.id)
      .eq('event_type', 'group_deletion_scheduled_inactivity');
    expect(events).toHaveLength(1);
  });

  test('create_market and join_group both reject while the inactivity deletion is pending', async () => {
    // A genuinely new membership is required to reach the deletion check —
    // an already-active member re-using the invite code short-circuits to a
    // no-op reactivation before that check is ever reached.
    const newcomer = await createTestUsers('iex3', ['newcomer']);
    try {
      const { error: joinErr } = await newcomer.newcomer.client.rpc('join_group', {
        p_invite_code: group.invite_code,
        p_nickname: 'newcomer',
      });
      expect(joinErr?.message).toMatch(/scheduled for deletion/);
    } finally {
      await cleanupTestUsers(newcomer);
    }

    const { error: createErr } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'blocked by pending deletion',
      p_description: 'x',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
    });
    expect(createErr?.message).toMatch(/scheduled for deletion/);
  });

  test('continuing the season (start_season) automatically cancels the pending inactivity deletion', async () => {
    const { error: startErr } = await users.owner.client.rpc('start_season', { p_group_id: group.id });
    expect(startErr).toBeNull();

    const { data: groupRow } = await adminClient.from('groups').select('deletion_scheduled_at').eq('id', group.id).single();
    expect(groupRow!.deletion_scheduled_at).toBeNull();

    const { data: event } = await adminClient
      .from('notification_events')
      .select('event_type, actor_id')
      .eq('group_id', group.id)
      .eq('event_type', 'group_deletion_canceled')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(event).toBeTruthy();
    expect(event!.actor_id).toBe(users.owner.id); // this cancellation really was the owner's doing
  });
});

describe('manual cancel_group_deletion still works on an inactivity-triggered schedule', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('iex2', ['owner']);
    group = await setupGroup(users.owner, [], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
    await users.owner.client.rpc('end_season', { p_group_id: group.id });
    const { data: intermission } = await adminClient.from('seasons').select('id').eq('group_id', group.id).eq('status', 'intermission').single();
    await backdate('seasons', 'id', intermission!.id, 'started_at', 31 * 24);
    await adminClient.rpc('expire_stale');
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('the owner can cancel it directly, same as any other scheduled deletion', async () => {
    const { data: before } = await adminClient.from('groups').select('deletion_scheduled_at').eq('id', group.id).single();
    expect(before!.deletion_scheduled_at).not.toBeNull();

    const { error } = await users.owner.client.rpc('cancel_group_deletion', { p_group_id: group.id });
    expect(error).toBeNull();

    const { data: after } = await adminClient.from('groups').select('deletion_scheduled_at').eq('id', group.id).single();
    expect(after!.deletion_scheduled_at).toBeNull();
  });
});
