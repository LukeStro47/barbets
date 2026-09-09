import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

/**
 * join_group(p_invite_code, p_nickname, p_join_source) records how an invite arrived on the
 * group_join lifecycle row (20260909100000_join_group_source.sql), so the admin site can compare
 * QR scans against typed codes and shared links. lifecycle_events rows have user_id `on delete
 * set null`, so cleanup deletes the rows this file wrote by group id before the group and users go.
 */
describe('join_group records its source on the group_join lifecycle row', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('joinsrc', ['owner', 'qr', 'typed', 'bare', 'bogus']);
    group = await setupGroup(users.owner, []);
  });

  afterAll(async () => {
    await adminClient.from('lifecycle_events').delete().eq('group_id', group.id);
    await cleanupTestUsers(users);
  });

  async function sourceFor(user: TestUser): Promise<string | null | undefined> {
    const { data, error } = await adminClient
      .from('lifecycle_events')
      .select('metadata')
      .eq('event_type', 'group_join')
      .eq('group_id', group.id)
      .eq('user_id', user.id)
      .single();
    if (error) throw new Error(`lifecycle_events lookup: ${error.message}`);
    return (data.metadata as { source?: string | null } | null)?.source;
  }

  test("'qr' lands in metadata.source", async () => {
    const { error } = await users.qr.client.rpc('join_group', {
      p_invite_code: group.invite_code,
      p_nickname: users.qr.tag,
      p_join_source: 'qr',
    });
    expect(error).toBeNull();
    expect(await sourceFor(users.qr)).toBe('qr');
  });

  test("'code' lands in metadata.source", async () => {
    const { error } = await users.typed.client.rpc('join_group', {
      p_invite_code: group.invite_code,
      p_nickname: users.typed.tag,
      p_join_source: 'code',
    });
    expect(error).toBeNull();
    expect(await sourceFor(users.typed)).toBe('code');
  });

  test('omitting the argument still works (the old two-argument call) and records null', async () => {
    const { error } = await users.bare.client.rpc('join_group', {
      p_invite_code: group.invite_code,
      p_nickname: users.bare.tag,
    });
    expect(error).toBeNull();
    expect(await sourceFor(users.bare)).toBeNull();
  });

  test('an unrecognized source is stored as null, never rejected', async () => {
    const { data, error } = await users.bogus.client.rpc('join_group', {
      p_invite_code: group.invite_code,
      p_nickname: users.bogus.tag,
      p_join_source: 'carrier-pigeon',
    });
    expect(error).toBeNull();
    const membership = (Array.isArray(data) ? data[0] : data) as { group_id: string; status: string };
    expect(membership.group_id).toBe(group.id);
    expect(membership.status).toBe('active');
    expect(await sourceFor(users.bogus)).toBeNull();
  });

  test('only one join_group overload exists, so a call that omits p_join_source is unambiguous', async () => {
    // The dropped two-argument signature must be gone: PostgREST can't choose between
    // join_group(text, citext) and join_group(text, citext, text) for a two-argument call.
    const { error } = await users.owner.client.rpc('join_group', { p_invite_code: 'ZZZZ' });
    // A miss (no such code) is zero rows and no error; an overload clash is a PGRST203 error.
    expect(error?.code).not.toBe('PGRST203');
  });
});
