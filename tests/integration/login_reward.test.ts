import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

/**
 * The 7-day login reward (GitHub #92): streaks, the day-7 event, the claim, and the per-group
 * amount rules. A "day" here is whatever local day the client reports, so the suite drives a
 * week of opens through the service-role-only `_record_app_open(p_user_id, p_local_day)` with
 * explicit consecutive dates rather than waiting a week; the authenticated `record_app_open`
 * wrapper is exercised separately for its +/-1 day clamp.
 */

/** YYYY-MM-DD for `offsetDays` from today, in UTC -- the same calendar Postgres's current_date
 *  reads, which is what the clamp tests compare against. */
function utcDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function driveOpen(user: TestUser, day: string): Promise<{ current_streak: number; changed: boolean }> {
  const { data, error } = await adminClient.rpc('_record_app_open', { p_user_id: user.id, p_local_day: day });
  if (error) throw new Error(`_record_app_open(${user.tag}, ${day}): ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as { current_streak: number; changed: boolean };
}

async function streakOf(user: TestUser): Promise<number> {
  const { data, error } = await adminClient.from('login_streaks').select('current_streak').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data?.current_streak ?? 0;
}

async function readyEvents(user: TestUser) {
  const { data, error } = await adminClient
    .from('notification_events')
    .select('id, group_id, market_id, actor_id')
    .eq('event_type', 'login_reward_ready')
    .eq('actor_id', user.id);
  if (error) throw error;
  return data ?? [];
}

async function membership(groupId: string, userId: string) {
  const { data, error } = await adminClient.from('memberships').select('id, balance').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data;
}

async function rewardRows(membershipId: string) {
  const { data, error } = await adminClient.from('ledger').select('amount, reason, market_id, bet_id').eq('membership_id', membershipId).eq('reason', 'reward');
  if (error) throw error;
  return data ?? [];
}

function settingsCall(owner: TestUser, group: GroupRow, seedAmount: number, loginRewardAmount: number | null) {
  return owner.client.rpc('update_group_settings', {
    p_group_id: group.id,
    p_seed_amount: seedAmount,
    p_seasons_enabled: false,
    p_season_length: null,
    p_timezone: 'UTC',
    p_betting_enabled: true,
    p_accepting_members: true,
    p_login_reward_amount: loginRewardAmount,
  });
}

describe('7-day login reward', () => {
  let users: Record<string, TestUser>;
  // a is in all three; b is in defaultGroup only. defaultGroup: seed 1000, amount null -> 50.
  // offGroup: seed 1000, amount 0 -> nothing. explicitGroup: seed 100, amount 20 -> 20.
  let defaultGroup: GroupRow;
  let offGroup: GroupRow;
  let explicitGroup: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('lrw', ['owner', 'a', 'b', 'out']);
    defaultGroup = await setupGroup(users.owner, [users.a, users.b], { seedAmount: 1000 });
    offGroup = await setupGroup(users.owner, [users.a], { seedAmount: 1000 });
    explicitGroup = await setupGroup(users.owner, [users.a], { seedAmount: 100 });

    const off = await settingsCall(users.owner, offGroup, 1000, 0);
    if (off.error) throw new Error(`turn reward off: ${off.error.message}`);
    const explicit = await settingsCall(users.owner, explicitGroup, 100, 20);
    if (explicit.error) throw new Error(`set explicit reward: ${explicit.error.message}`);
  });

  afterAll(async () => {
    // login_reward_ready rows carry no group, so they don't cascade away with the groups the way
    // every other test's events do, and actor_id nulls (not cascades) on user delete.
    const ids = Object.values(users).map((u) => u.id);
    await adminClient.from('notification_events').delete().eq('event_type', 'login_reward_ready').in('actor_id', ids);
    await cleanupTestUsers(users);
  });

  test('settings: the amount round-trips, null means default, and the audit row names the field', async () => {
    const { data: rows } = await adminClient
      .from('group_settings')
      .select('group_id, seed_amount, login_reward_amount')
      .in('group_id', [defaultGroup.id, offGroup.id, explicitGroup.id]);
    const byGroup = new Map((rows ?? []).map((r) => [r.group_id, r]));
    expect(byGroup.get(defaultGroup.id)!.login_reward_amount).toBeNull();
    expect(byGroup.get(offGroup.id)!.login_reward_amount).toBe(0);
    expect(byGroup.get(explicitGroup.id)!.login_reward_amount).toBe(20);

    const { data: audit } = await adminClient
      .from('lifecycle_events')
      .select('metadata')
      .eq('event_type', 'settings_update')
      .eq('group_id', explicitGroup.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect((audit!.metadata as { changed_fields: string[] }).changed_fields).toContain('login_reward_amount');
    expect((audit!.metadata as { basic_changed: boolean }).basic_changed).toBe(true);
  });

  test('settings: out-of-range amounts are refused, a non-owner cannot set it', async () => {
    const { error: negative } = await settingsCall(users.owner, explicitGroup, 100, -1);
    expect(negative?.message).toMatch(/invalid_operation/);
    expect(negative?.message).toMatch(/between 0 and 1,000,000/);

    const { error: huge } = await settingsCall(users.owner, explicitGroup, 100, 1_000_001);
    expect(huge?.message).toMatch(/invalid_operation/);

    const { error: notOwner } = await settingsCall(users.a, explicitGroup, 100, 5);
    expect(notOwner?.message).toMatch(/forbidden/);

    const { data: row } = await adminClient.from('group_settings').select('login_reward_amount').eq('group_id', explicitGroup.id).single();
    expect(row!.login_reward_amount).toBe(20);
  });

  test('get_login_reward_status quotes each group at its effective amount before any open', async () => {
    const { data, error } = await users.a.client.rpc('get_login_reward_status');
    expect(error).toBeNull();
    const status = data as { current_streak: number; last_open_day: string | null; groups: { group_id: string; amount: number }[] };
    expect(status.current_streak).toBe(0);
    expect(status.last_open_day).toBeNull();
    const amountByGroup = new Map(status.groups.map((g) => [g.group_id, g.amount]));
    expect(amountByGroup.get(defaultGroup.id)).toBe(50);
    expect(amountByGroup.get(offGroup.id)).toBe(0);
    expect(amountByGroup.get(explicitGroup.id)).toBe(20);
  });

  test('seven consecutive days -> streak 7 -> one login_reward_ready event addressed to that user only', async () => {
    for (let i = 0; i < 7; i++) {
      const r = await driveOpen(users.a, utcDay(i - 6));
      expect(r.changed).toBe(true);
      expect(r.current_streak).toBe(i + 1);
      // Days 1-6 are silent.
      if (i < 6) expect(await readyEvents(users.a)).toHaveLength(0);
    }
    expect(await streakOf(users.a)).toBe(7);

    const events = await readyEvents(users.a);
    expect(events).toHaveLength(1);
    expect(events[0].group_id).toBeNull();
    expect(events[0].market_id).toBeNull();
    expect(events[0].actor_id).toBe(users.a.id);

    // Single recipient = the actor, once they have a subscription; nobody else, ever.
    const { error: subErr } = await users.a.client.from('push_subscriptions').insert({
      user_id: users.a.id,
      endpoint: `https://example.com/push/${users.a.id}`,
      p256dh: 'p256dh',
      auth_key: 'auth-key',
    });
    expect(subErr).toBeNull();
    const { data: recipients, error: recErr } = await adminClient.rpc('get_event_recipients', { p_event_id: events[0].id });
    expect(recErr).toBeNull();
    expect((recipients as { user_id: string }[]).map((r) => r.user_id)).toEqual([users.a.id]);

    // A same-day repeat is a no-op, and day 8 stays quiet: still exactly one event.
    const repeat = await driveOpen(users.a, utcDay(0));
    expect(repeat).toEqual({ current_streak: 7, changed: false });
    expect(await readyEvents(users.a)).toHaveLength(1);
  });

  test('the authenticated record_app_open accepts today and +/-1, refuses anything further out', async () => {
    // a is already counted for today via the driver above, so today and yesterday are no-ops
    // (yesterday is earlier than last_open_day) -- what matters here is that they're accepted.
    for (const day of [utcDay(0), utcDay(-1)]) {
      const { data, error } = await users.a.client.rpc('record_app_open', { p_local_day: day });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as { current_streak: number; changed: boolean };
      expect(row.changed).toBe(false);
      expect(row.current_streak).toBe(7);
    }
    for (const day of [utcDay(2), utcDay(-2), utcDay(30)]) {
      const { error } = await users.a.client.rpc('record_app_open', { p_local_day: day });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/out of range/);
    }
    expect(await streakOf(users.a)).toBe(7);
  });

  test('claim: one reward row per group at that group\'s amount, balances move, streak resets, next day restarts at 1', async () => {
    const before = {
      def: await membership(defaultGroup.id, users.a.id),
      off: await membership(offGroup.id, users.a.id),
      explicit: await membership(explicitGroup.id, users.a.id),
    };
    const bBefore = await membership(defaultGroup.id, users.b.id);

    const { data, error } = await users.a.client.rpc('claim_login_reward');
    expect(error).toBeNull();
    const credited = (data as { group_id: string; group_name: string; amount: number }[]).sort((x, y) => x.group_id.localeCompare(y.group_id));
    expect(credited.map((c) => [c.group_id, c.amount]).sort()).toEqual(
      [
        [defaultGroup.id, 50],
        [explicitGroup.id, 20],
      ].sort()
    );

    // Ledger: exactly one 'reward' row where it applies, none where it's off, no market/bet on it.
    const defRows = await rewardRows(before.def.id);
    expect(defRows).toHaveLength(1);
    expect(defRows[0]).toMatchObject({ amount: 50, reason: 'reward', market_id: null, bet_id: null });
    const explicitRows = await rewardRows(before.explicit.id);
    expect(explicitRows).toHaveLength(1);
    expect(explicitRows[0].amount).toBe(20);
    expect(await rewardRows(before.off.id)).toHaveLength(0);

    // Balances moved by exactly the ledger amounts, in the same transaction.
    expect((await membership(defaultGroup.id, users.a.id)).balance).toBe(before.def.balance + 50);
    expect((await membership(explicitGroup.id, users.a.id)).balance).toBe(before.explicit.balance + 20);
    expect((await membership(offGroup.id, users.a.id)).balance).toBe(before.off.balance);
    // The reward counts toward net like any other non-seed entry.
    const { data: net } = await users.a.client.from('membership_ledger_net').select('net').eq('membership_id', before.def.id).single();
    expect(Number(net!.net)).toBe(50);

    // Nobody else's balance or streak moved.
    expect((await membership(defaultGroup.id, users.b.id)).balance).toBe(bBefore.balance);
    expect(await streakOf(users.b)).toBe(0);

    // Streak reset; a same-day re-open stays at 0; tomorrow starts a fresh run at 1.
    expect(await streakOf(users.a)).toBe(0);
    expect(await driveOpen(users.a, utcDay(0))).toEqual({ current_streak: 0, changed: false });
    const { data: status } = await users.a.client.rpc('get_login_reward_status');
    expect((status as { current_streak: number }).current_streak).toBe(0);
    expect(await driveOpen(users.a, utcDay(1))).toEqual({ current_streak: 1, changed: true });
  });

  test('a second claim without a new 7-day run is refused with a friendly invalid_operation', async () => {
    const { error } = await users.a.client.rpc('claim_login_reward');
    expect(error?.message).toMatch(/^invalid_operation: /);
    expect(error?.message).toMatch(/seven days in a row/);
    expect(error?.message).not.toMatch(/—/);

    const m = await membership(defaultGroup.id, users.a.id);
    expect(await rewardRows(m.id)).toHaveLength(1);
  });

  test('a missed day resets the counter to a fresh run of 1', async () => {
    expect(await driveOpen(users.b, utcDay(-9))).toEqual({ current_streak: 1, changed: true });
    expect(await driveOpen(users.b, utcDay(-8))).toEqual({ current_streak: 2, changed: true });
    // Skip -7.
    expect(await driveOpen(users.b, utcDay(-6))).toEqual({ current_streak: 1, changed: true });
    expect(await driveOpen(users.b, utcDay(-5))).toEqual({ current_streak: 2, changed: true });
    // A day that's already behind the latest one is ignored rather than counted or reset.
    expect(await driveOpen(users.b, utcDay(-8))).toEqual({ current_streak: 2, changed: false });
    expect(await readyEvents(users.b)).toHaveLength(0);
  });

  test('two members of one group on different schedules claim on different days without touching each other', async () => {
    // b continues -4 .. 0: that's 7 straight from -6, so b is ready today while a is on day 1 of a new run.
    for (let i = -4; i <= 0; i++) await driveOpen(users.b, utcDay(i));
    expect(await streakOf(users.b)).toBe(7);
    expect(await readyEvents(users.b)).toHaveLength(1);
    expect(await streakOf(users.a)).toBe(1);

    const aBefore = await membership(defaultGroup.id, users.a.id);
    const { data, error } = await users.b.client.rpc('claim_login_reward');
    expect(error).toBeNull();
    // b is only in defaultGroup: one row, at that group's default 5% of 1,000.
    expect(data).toHaveLength(1);
    expect((data as { group_id: string; amount: number }[])[0]).toMatchObject({ group_id: defaultGroup.id, amount: 50 });

    const bM = await membership(defaultGroup.id, users.b.id);
    expect(await rewardRows(bM.id)).toHaveLength(1);
    expect(bM.balance).toBe(1050);
    expect(await streakOf(users.b)).toBe(0);

    // a: untouched by b's claim in every respect.
    expect((await membership(defaultGroup.id, users.a.id)).balance).toBe(aBefore.balance);
    expect(await rewardRows(aBefore.id)).toHaveLength(1);
    expect(await streakOf(users.a)).toBe(1);
  });

  test('a member who joins mid-streak gets that group\'s reward on their own day 7', async () => {
    // out has no groups yet. Streak days 1-4, then they join explicitGroup, then days 5-7.
    for (let i = -6; i <= -3; i++) await driveOpen(users.out, utcDay(i));
    const { error: joinErr } = await users.out.client.rpc('join_group', { p_invite_code: explicitGroup.invite_code, p_nickname: users.out.tag });
    expect(joinErr).toBeNull();
    for (let i = -2; i <= 0; i++) await driveOpen(users.out, utcDay(i));
    expect(await streakOf(users.out)).toBe(7);

    const { data, error } = await users.out.client.rpc('claim_login_reward');
    expect(error).toBeNull();
    expect(data).toEqual([{ group_id: explicitGroup.id, group_name: expect.any(String), amount: 20 }]);
    expect((await membership(explicitGroup.id, users.out.id)).balance).toBe(120);
  });

  test('get_group_login_streaks: members see the roster\'s streaks, a non-member gets not_found', async () => {
    const { data, error } = await users.b.client.rpc('get_group_login_streaks', { p_group_id: defaultGroup.id });
    expect(error).toBeNull();
    const byUser = new Map((data as { user_id: string; current_streak: number }[]).map((r) => [r.user_id, r.current_streak]));
    expect(byUser.get(users.a.id)).toBe(1);
    expect(byUser.get(users.b.id)).toBe(0);
    expect(byUser.get(users.owner.id)).toBe(0);

    const { error: outsiderErr } = await users.out.client.rpc('get_group_login_streaks', { p_group_id: defaultGroup.id });
    expect(outsiderErr?.message).toMatch(/not_found/);
  });

  test('the streak table and the driver are not reachable by a signed-in client', async () => {
    const { data: rows, error: selectErr } = await users.a.client.from('login_streaks').select('*');
    // Zero-policy table: RLS filters everything, no error, no rows.
    expect(selectErr).toBeNull();
    expect(rows).toEqual([]);

    const { error: driverErr } = await users.a.client.rpc('_record_app_open', { p_user_id: users.a.id, p_local_day: utcDay(5) });
    expect(driverErr).not.toBeNull();
  });
});
