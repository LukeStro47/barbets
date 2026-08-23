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

  test('uploading a photo clears a previously-set preset', async () => {
    await users.a.client.rpc('set_avatar_preset', { p_avatar_key: 'dice' });
    await users.a.client.rpc('set_avatar_uploaded', { p_uploaded: true });

    const { data: aRow } = await adminClient.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', users.a.id).single();
    expect(aRow!.avatar_updated_at).not.toBeNull();
    expect(aRow!.avatar_preset_key).toBeNull();

    await users.a.client.rpc('set_avatar_uploaded', { p_uploaded: false });
  });
});

describe('set_avatar_preset', () => {
  let users: Record<string, TestUser>;

  beforeAll(async () => {
    users = await createTestUsers('avatarpreset', ['a', 'b']);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('setting it stamps avatar_preset_key on the caller only', async () => {
    const { data, error } = await users.a.client.rpc('set_avatar_preset', { p_avatar_key: 'trophy' });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.avatar_preset_key).toBe('trophy');

    const { data: bRow } = await adminClient.from('users').select('avatar_preset_key').eq('id', users.b.id).single();
    expect(bRow!.avatar_preset_key).toBeNull();
  });

  test('picking a preset clears a previously-uploaded photo', async () => {
    await users.a.client.rpc('set_avatar_uploaded', { p_uploaded: true });
    await users.a.client.rpc('set_avatar_preset', { p_avatar_key: 'oracle' });

    const { data: aRow } = await adminClient.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', users.a.id).single();
    expect(aRow!.avatar_preset_key).toBe('oracle');
    expect(aRow!.avatar_updated_at).toBeNull();
  });

  test('rejects a key that is not shaped like a valid avatar key', async () => {
    const { error } = await users.a.client.rpc('set_avatar_preset', { p_avatar_key: 'not a valid key!' });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('a blank key clears the preset back to initials', async () => {
    await users.a.client.rpc('set_avatar_preset', { p_avatar_key: 'trophy' });
    const { error } = await users.a.client.rpc('set_avatar_preset', { p_avatar_key: '' });
    expect(error).toBeNull();

    const { data: aRow } = await adminClient.from('users').select('avatar_preset_key').eq('id', users.a.id).single();
    expect(aRow!.avatar_preset_key).toBeNull();
  });
});
