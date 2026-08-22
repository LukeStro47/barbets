import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';

describe('set_avatar_uploaded', () => {
  let users: Record<string, TestUser>;

  beforeAll(async () => {
    users = await createTestUsers('avatar', ['a', 'b']);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('setting it stamps avatar_updated_at on the caller only', async () => {
    const { data, error } = await users.a.client.rpc('set_avatar_uploaded', { p_uploaded: true });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.avatar_updated_at).not.toBeNull();

    const { data: aRow } = await adminClient.from('users').select('avatar_updated_at').eq('id', users.a.id).single();
    expect(aRow!.avatar_updated_at).not.toBeNull();

    const { data: bRow } = await adminClient.from('users').select('avatar_updated_at').eq('id', users.b.id).single();
    expect(bRow!.avatar_updated_at).toBeNull();
  });

  test('clearing it sets avatar_updated_at back to null', async () => {
    await users.a.client.rpc('set_avatar_uploaded', { p_uploaded: true });
    const { error } = await users.a.client.rpc('set_avatar_uploaded', { p_uploaded: false });
    expect(error).toBeNull();

    const { data: aRow } = await adminClient.from('users').select('avatar_updated_at').eq('id', users.a.id).single();
    expect(aRow!.avatar_updated_at).toBeNull();
  });
});
