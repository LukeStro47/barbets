import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

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

  test('turning it off blocks a genuinely new join but not a dormant reactivation', async () => {
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

  test('owner deleting the group cascades away memberships and markets', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });

    const { error } = await users.owner.client.rpc('delete_group', { p_group_id: group.id });
    expect(error).toBeNull();

    const { data: groupRow } = await adminClient.from('groups').select('id').eq('id', group.id).maybeSingle();
    expect(groupRow).toBeNull();
    const { data: memberRows } = await adminClient.from('memberships').select('id').eq('group_id', group.id);
    expect(memberRows).toEqual([]);
    const { data: marketRow } = await adminClient.from('markets').select('id').eq('id', market.id).maybeSingle();
    expect(marketRow).toBeNull();
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
});
