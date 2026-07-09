import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

describe('per-group nicknames', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('nick', ['owner', 'a']);
    group = await setupGroup(users.owner, [users.a]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a duplicate nickname within the same group is rejected on join', async () => {
    const dupe = await createTestUsers('nickdup', ['b']);
    try {
      const { error } = await dupe.b.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'a' });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/taken/);
    } finally {
      await cleanupTestUsers(dupe);
    }
  });

  test('leaving and rejoining keeps the original nickname, not a re-prompted one', async () => {
    const leaver = await createTestUsers('nickrj', ['x']);
    try {
      await leaver.x.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'origx' });
      await leaver.x.client.rpc('leave_group', { p_group_id: group.id });

      // rejoining with a *different* requested nickname should be ignored —
      // reactivation keeps whatever nickname the membership already has.
      const { data, error } = await leaver.x.client.rpc('join_group', {
        p_invite_code: group.invite_code,
        p_nickname: 'somethingelse',
      });
      expect(error).toBeNull();
      const membership = Array.isArray(data) ? data[0] : data;
      expect(membership.nickname).toBe('origx');
    } finally {
      await cleanupTestUsers(leaver);
    }
  });

  test('update_nickname changes your own nickname and rejects a collision with another member', async () => {
    const { data: renamed, error: renameErr } = await users.a.client.rpc('update_nickname', {
      p_group_id: group.id,
      p_nickname: 'a_renamed',
    });
    expect(renameErr).toBeNull();
    const renamedRow = Array.isArray(renamed) ? renamed[0] : renamed;
    expect(renamedRow.nickname).toBe('a_renamed');

    const { error: collideErr } = await users.a.client.rpc('update_nickname', {
      p_group_id: group.id,
      p_nickname: 'owner',
    });
    expect(collideErr?.message).toMatch(/invalid_operation/);
    expect(collideErr?.message).toMatch(/taken/);

    // renaming to your own current nickname is a harmless no-op, not a self-collision
    const { error: sameNameErr } = await users.a.client.rpc('update_nickname', {
      p_group_id: group.id,
      p_nickname: 'a_renamed',
    });
    expect(sameNameErr).toBeNull();
  });

  test('update_nickname rejects a non-member and an invalid format', async () => {
    const outsider = await createTestUsers('nickout', ['y']);
    try {
      const { error: notMemberErr } = await outsider.y.client.rpc('update_nickname', {
        p_group_id: group.id,
        p_nickname: 'whatever',
      });
      expect(notMemberErr?.message).toMatch(/^not_found/);
    } finally {
      await cleanupTestUsers(outsider);
    }

    const { error: badFormatErr } = await users.owner.client.rpc('update_nickname', {
      p_group_id: group.id,
      p_nickname: 'has a space',
    });
    expect(badFormatErr?.message).toMatch(/invalid_operation/);
  });

  test('the nickname passed to create_group is what actually lands on the owner membership row', async () => {
    const { data: ownerRow } = await adminClient
      .from('memberships')
      .select('nickname')
      .eq('group_id', group.id)
      .eq('user_id', users.owner.id)
      .single();
    expect(ownerRow!.nickname).toBe('owner');
  });
});
