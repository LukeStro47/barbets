import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createTestUsers, cleanupTestUsers, adminClient, SUPABASE_URL, ANON_KEY, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

type Details = {
  member_count: number;
  open_count: number;
  settled_count: number;
  created_at: string;
  opening_balance: number | null;
  resolution_window_hours: number;
  faces: { user_id: string; initial: string; avatar_updated_at: string | null; avatar_preset_key: string | null }[];
};

/** Same never-generated shape as invite_code_rate_limit.test.ts's bogusCode(). */
const BOGUS = 'Z0ZZ';

async function forceStatus(marketId: string, status: 'open' | 'resolved') {
  const { error } = await adminClient.from('markets').update({ status }).eq('id', marketId);
  if (error) throw new Error(`forceStatus: ${error.message}`);
}

describe('get_invite_details / is_invite_nickname_free (5d/5e)', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let aboutLeaver: string;

  beforeAll(async () => {
    users = await createTestUsers('invdet', ['owner', 'member', 'leaver', 'visitor']);
    group = await setupGroup(users.owner, [users.member, users.leaver], { seedAmount: 750 });

    const plain = await createMarket(users.owner, group.id);
    await forceStatus(plain.id, 'open');
    const about = await createMarket(users.owner, group.id, { subjectIds: [users.leaver.id] });
    await forceStatus(about.id, 'open');
    aboutLeaver = about.id;
    const settled = await createMarket(users.owner, group.id);
    await forceStatus(settled.id, 'resolved');

    const { error } = await users.leaver.client.rpc('leave_group', { p_group_id: group.id });
    if (error) throw new Error(`leave_group: ${error.message}`);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a non-member gets counts, the opening balance and faces, and nothing about any market', async () => {
    const { data, error } = await users.visitor.client.rpc('get_invite_details', { p_invite_code: group.invite_code }).single();
    expect(error).toBeNull();
    const d = data as Details;
    expect(d.member_count).toBe(2);
    expect(d.open_count).toBe(2);
    expect(d.settled_count).toBe(1);
    expect(d.opening_balance).toBe(750);
    expect(Number(d.resolution_window_hours)).toBeGreaterThan(0);
    expect(d.faces.map((f) => f.user_id).sort()).toEqual([users.owner.id, users.member.id].sort());
    // A face carries one letter of the nickname, never the nickname.
    for (const f of d.faces) expect(f.initial.length).toBe(1);
    expect(JSON.stringify(d)).not.toMatch(/Test market/);
  });

  test("the open count skips a market the caller is the hidden subject of", async () => {
    const { data } = await users.leaver.client.rpc('get_invite_details', { p_invite_code: group.invite_code }).single();
    expect((data as Details).open_count).toBe(1);
    expect(aboutLeaver).toBeTruthy();
  });

  test('an unknown code returns nothing and counts as a miss', async () => {
    const { data, error } = await users.visitor.client.rpc('get_invite_details', { p_invite_code: BOGUS });
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const { data: row } = await adminClient.from('invite_code_attempts').select('miss_count').eq('user_id', users.visitor.id).maybeSingle();
    expect((row as { miss_count: number } | null)?.miss_count).toBeGreaterThanOrEqual(1);
  });

  test('nickname check: taken, free, case-insensitive, malformed, and a left member frees theirs', async () => {
    const check = async (nick: string) =>
      (await users.visitor.client.rpc('is_invite_nickname_free', { p_invite_code: group.invite_code, p_nickname: nick })).data;
    expect(await check(users.member.tag)).toBe(false);
    expect(await check(users.member.tag.toUpperCase())).toBe(false);
    expect(await check('nobody_has_this')).toBe(true);
    expect(await check('has space')).toBeNull();
    expect(await check(users.leaver.tag)).toBe(true);
  });

  test('both are closed to anon', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const a = await anon.rpc('get_invite_details', { p_invite_code: group.invite_code });
    const b = await anon.rpc('is_invite_nickname_free', { p_invite_code: group.invite_code, p_nickname: 'x' });
    expect(a.error).not.toBeNull();
    expect(b.error).not.toBeNull();
  });
});
