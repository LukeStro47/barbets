import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

async function membershipRow(groupId: string, userId: string) {
  const { data, error } = await adminClient.from('memberships').select('*').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data!;
}

describe('accepting_members toggle', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('acc', ['owner', 'a']);
    group = await setupGroup(users.owner, [users.a]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('turning it off blocks a genuinely new join but not a left member rejoining', async () => {
    const { error: offErr } = await users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: false,
    });
    expect(offErr).toBeNull();

    const stranger = await createTestUsers('accnew', ['x']);
    try {
      const { error: joinErr } = await stranger.x.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'strangerx' });
      expect(joinErr?.message).toMatch(/invalid_operation/);
      expect(joinErr?.message).toMatch(/accepting new members/);
    } finally {
      await cleanupTestUsers(stranger);
    }

    // existing member leaving and rejoining is not "new" — still allowed
    await users.a.client.rpc('leave_group', { p_group_id: group.id });
    const { error: rejoinErr } = await users.a.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'a' });
    expect(rejoinErr).toBeNull();

    // restore for other tests in this file, if any reuse the group
    await users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
    });
  });
});

describe('transfer_ownership', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('xfer', ['owner', 'a', 'b']);
    group = await setupGroup(users.owner, [users.a, users.b]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('non-owner cannot transfer ownership', async () => {
    const { error } = await users.a.client.rpc('transfer_ownership', { p_group_id: group.id, p_new_owner_id: users.b.id });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('cannot transfer to yourself or to a non-member', async () => {
    const { error: selfErr } = await users.owner.client.rpc('transfer_ownership', { p_group_id: group.id, p_new_owner_id: users.owner.id });
    expect(selfErr?.message).toMatch(/invalid_operation/);

    const outsider = await createTestUsers('xferout', ['y']);
    try {
      const { error: outsiderErr } = await users.owner.client.rpc('transfer_ownership', { p_group_id: group.id, p_new_owner_id: outsider.y.id });
      expect(outsiderErr?.message).toMatch(/invalid_operation/);
    } finally {
      await cleanupTestUsers(outsider);
    }
  });

  test('owner can transfer to an active member; old owner becomes a regular member', async () => {
    const { data, error } = await users.owner.client.rpc('transfer_ownership', { p_group_id: group.id, p_new_owner_id: users.a.id });
    expect(error).toBeNull();
    const updated = Array.isArray(data) ? data[0] : data;
    expect(updated.owner_id).toBe(users.a.id);

    const { data: groupRow } = await adminClient.from('groups').select('owner_id').eq('id', group.id).single();
    expect(groupRow!.owner_id).toBe(users.a.id);

    // old owner is now removable by the new owner
    const { error: removeErr } = await users.a.client.rpc('remove_member', { p_group_id: group.id, p_target_user_id: users.owner.id });
    expect(removeErr).toBeNull();
    const oldOwnerRow = await membershipRow(group.id, users.owner.id);
    expect(oldOwnerRow.status).toBe('removed');
  });
});

describe('delete_group', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('delg', ['owner', 'a']);
    group = await setupGroup(users.owner, [users.a]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('non-owner cannot delete the group', async () => {
    const { error } = await users.a.client.rpc('delete_group', { p_group_id: group.id });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('owner deleting the group voids open markets and deletes the group immediately, no grace period', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });

    // Succeeding at all here (rather than raising) confirms the void-open-markets loop ran
    // cleanly against a market with a real bet on it, before the group itself was dropped.
    const { error } = await users.owner.client.rpc('delete_group', { p_group_id: group.id });
    expect(error).toBeNull();

    // The group (and everything cascaded from it — memberships, the market, the bet) is
    // genuinely gone right away, no deletion_scheduled_at window, nothing left to read. That
    // also means there's no post-delete state left to inspect the void/refund's exact numbers
    // against directly — the RPC not erroring is the signal that path completed.
    const { data: groupRow } = await adminClient.from('groups').select('id').eq('id', group.id).maybeSingle();
    expect(groupRow).toBeNull();
    const { data: memberRows } = await adminClient.from('memberships').select('id').eq('group_id', group.id);
    expect(memberRows!.length).toBe(0);
    const { data: bet } = await adminClient.from('bets').select('id').eq('market_id', market.id).maybeSingle();
    expect(bet).toBeNull();

    // Deleting an already-gone group (or one that never existed) is a clean not_found, not a crash.
    const { error: reDeleteErr } = await users.owner.client.rpc('delete_group', { p_group_id: group.id });
    expect(reDeleteErr?.message).toMatch(/not_found/);
  });
});

describe('delete_account', () => {
  test('blocked while the caller still owns a group', async () => {
    const users = await createTestUsers('delacct1', ['owner']);
    try {
      await setupGroup(users.owner, []);
      const { error } = await users.owner.client.rpc('delete_account');
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/transfer ownership or delete/);
    } finally {
      await cleanupTestUsers(users);
    }
  });

  test('cleans up every membership: refunds open bets, voids subject markets, marks removed, rotates the code', async () => {
    const users = await createTestUsers('delacct2', ['owner', 'sponsor', 'leaver']);
    try {
      const group = await setupGroup(users.owner, [users.sponsor, users.leaver], { seedAmount: 1000 });
      const oldInviteCode = group.invite_code;

      const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 60000);
      const { error: betErr } = await users.leaver.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 50 });
      expect(betErr).toBeNull();

      const before = await membershipRow(group.id, users.leaver.id);
      expect(before.balance).toBe(950);

      const { error } = await users.leaver.client.rpc('delete_account');
      expect(error).toBeNull();

      const after = await membershipRow(group.id, users.leaver.id);
      expect(after.status).toBe('removed');
      expect(after.balance).toBe(1000); // bet refunded

      const { data: betRow } = await adminClient.from('bets').select('settled_at, payout').eq('market_id', market.id).eq('user_id', users.leaver.id).single();
      expect(betRow!.settled_at).not.toBeNull();
      expect(betRow!.payout).toBe(50);

      const { data: groupRow } = await adminClient.from('groups').select('invite_code').eq('id', group.id).single();
      expect(groupRow!.invite_code).not.toBe(oldInviteCode);
    } finally {
      await cleanupTestUsers(users);
    }
  });

  test('a user who has triggered a notification event can still delete their account, and the event survives with a null actor', async () => {
    const users = await createTestUsers('delacct3', ['owner', 'sponsor']);
    try {
      const group = await setupGroup(users.owner, [users.sponsor]);
      const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
      // sponsor_market sets actor_id = sponsor on the market_opened event — the group is still
      // very much alive at this point, unlike the previous test's cleanup-time deletion, so this
      // is the real self-service deleteAccount() scenario: the row that would reference the
      // deleted user isn't going away via any group-level cascade.
      const { error: sponsorErr } = await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      expect(sponsorErr).toBeNull();

      const { data: eventBefore } = await adminClient
        .from('notification_events')
        .select('id, actor_id')
        .eq('market_id', market.id)
        .eq('event_type', 'market_opened')
        .single();
      expect(eventBefore!.actor_id).toBe(users.sponsor.id);

      // The real two-step deleteAccount() flow: the public-schema cleanup RPC first (as the
      // user), then the service-role auth deletion (which is what used to fail here — see
      // 20260822160000_notification_events_actor_fk_set_null.sql).
      const { error: cleanupErr } = await users.sponsor.client.rpc('delete_account');
      expect(cleanupErr).toBeNull();
      const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(users.sponsor.id);
      expect(authDeleteErr).toBeNull();

      const { data: eventAfter } = await adminClient
        .from('notification_events')
        .select('id, actor_id')
        .eq('id', eventBefore!.id)
        .single();
      expect(eventAfter!.actor_id).toBeNull();
    } finally {
      // sponsor is already gone; cleanupTestUsers tolerates a second delete attempt failing.
      await cleanupTestUsers(users);
    }
  });
});

describe('token allocation bounds', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('tokcap', ['owner']);
    group = await setupGroup(users.owner, [], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  function settingsCall(seedAmount: number) {
    return users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: seedAmount,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
    });
  }

  test('create_group rejects an allocation outside 1..1,000,000', async () => {
    for (const amount of [0, -50, 1_000_001]) {
      const { error } = await users.owner.client.rpc('create_group', {
        p_name: `cap ${amount}`,
        p_seed_amount: amount,
        p_seasons_enabled: false,
        p_season_length: null,
        p_nickname: 'owner',
        p_timezone: 'UTC',
      });
      expect(error?.message).toMatch(/token allocation must be between/);
    }
  });

  test('update_group_settings rejects the same values and accepts the cap itself', async () => {
    const { error: tooBig } = await settingsCall(1_000_001);
    expect(tooBig?.message).toMatch(/token allocation must be between/);

    const { error: zero } = await settingsCall(0);
    expect(zero?.message).toMatch(/token allocation must be between/);

    const { error: atCap } = await settingsCall(1_000_000);
    expect(atCap).toBeNull();

    const { data: settings } = await adminClient.from('group_settings').select('seed_amount').eq('group_id', group.id).single();
    expect(settings!.seed_amount).toBe(1_000_000);
  });

  test('a group already stored above the cap can still save its other settings', async () => {
    // Only reachable by a row that predates the bound, so write it the way one
    // of those rows got there: straight past the function.
    await adminClient.from('group_settings').update({ seed_amount: 5_000_000 }).eq('group_id', group.id);

    const { error: unchanged } = await settingsCall(5_000_000);
    expect(unchanged).toBeNull();

    // ...but it still can't be moved anywhere except back into range.
    const { error: higher } = await settingsCall(6_000_000);
    expect(higher?.message).toMatch(/token allocation must be between/);

    const { error: backInRange } = await settingsCall(2000);
    expect(backInRange).toBeNull();
  });
});
