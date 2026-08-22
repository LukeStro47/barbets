import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

function settingsCall(owner: TestUser, group: GroupRow, joinMessage: string | null) {
  return owner.client.rpc('update_group_settings', {
    p_group_id: group.id,
    p_seed_amount: 1000,
    p_seasons_enabled: false,
    p_season_length: null,
    p_timezone: 'UTC',
    p_betting_enabled: true,
    p_accepting_members: true,
    p_join_message: joinMessage,
  });
}

describe('group_settings.join_message', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('joinmsg', ['owner', 'member']);
    group = await setupGroup(users.owner, [users.member]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('owner sets a message; it round-trips through the settings row and get_group_join_message', async () => {
    const { error } = await settingsCall(users.owner, group, 'Welcome in. Read the pinned rules first.');
    expect(error).toBeNull();

    const { data: row } = await adminClient.from('group_settings').select('join_message').eq('group_id', group.id).single();
    expect(row!.join_message).toBe('Welcome in. Read the pinned rules first.');

    const { data: forOwner, error: ownerErr } = await users.owner.client.rpc('get_group_join_message', { p_group_id: group.id });
    expect(ownerErr).toBeNull();
    expect(forOwner).toBe('Welcome in. Read the pinned rules first.');

    const { data: forMember, error: memberErr } = await users.member.client.rpc('get_group_join_message', { p_group_id: group.id });
    expect(memberErr).toBeNull();
    expect(forMember).toBe('Welcome in. Read the pinned rules first.');
  });

  test('blank clears it back to null, both in storage and via the read function', async () => {
    await settingsCall(users.owner, group, '   ');
    const { data: row } = await adminClient.from('group_settings').select('join_message').eq('group_id', group.id).single();
    expect(row!.join_message).toBeNull();

    const { data } = await users.member.client.rpc('get_group_join_message', { p_group_id: group.id });
    expect(data).toBeNull();
  });

  test('rejects a message over 240 characters', async () => {
    const { error } = await settingsCall(users.owner, group, 'x'.repeat(241));
    expect(error?.message).toMatch(/invalid_operation/);
    expect(error?.message).toMatch(/240 characters/);
  });

  test('a non-member gets null rather than an error or the real message', async () => {
    await settingsCall(users.owner, group, 'members only, presumably');
    const outsider = await createTestUsers('joinmsgout', ['x']);
    try {
      const { data, error } = await outsider.x.client.rpc('get_group_join_message', { p_group_id: group.id });
      expect(error).toBeNull();
      expect(data).toBeNull();
    } finally {
      await cleanupTestUsers(outsider);
    }
  });
});
