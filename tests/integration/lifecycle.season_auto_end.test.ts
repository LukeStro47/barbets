import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

/**
 * expire_stale() has selected active seasons past their ends_at and called
 * end_season() on them since 20260719147000, and every one of those calls
 * raised. end_season() gates on auth.uid(), which is NULL under pg_cron, so
 * the membership check matched nothing and it raised `not_found: group not
 * found` - taking the entire platform-wide sweep down with it, every minute,
 * for as long as any group sat past its season end date.
 *
 * Nothing covered it because every other test in the suite uses
 * seasonLength 'manual', which leaves seasons.ends_at NULL and never reaches
 * that loop at all. These tests use a real timed length, which is the whole
 * point of them.
 */
describe('timed seasons end on their own', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('tae', ['owner', 'member']);
    group = await setupGroup(users.owner, [users.member], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: '1m',
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('create_group stamps a real ends_at for a timed season', async () => {
    const { data: season } = await adminClient
      .from('seasons')
      .select('id, ends_at')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .single();

    // The precondition the whole bug depended on: 'manual' groups get NULL
    // here and never reach the auto-end sweep, which is why this went unseen.
    expect(season!.ends_at).not.toBeNull();
  });

  test('expire_stale ends a season whose ends_at has passed, with no human involved', async () => {
    const { data: before } = await adminClient
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .single();

    await backdate('seasons', 'id', before!.id, 'ends_at', 1);

    const { error } = await adminClient.rpc('expire_stale');
    expect(error).toBeNull();

    const { data: after } = await adminClient.from('seasons').select('status, ended_at').eq('id', before!.id).single();
    // Nothing was in flight, so it archives outright rather than winding down.
    expect(after!.status).toBe('archived');
    expect(after!.ended_at).not.toBeNull();

    const { data: results } = await adminClient.from('season_results').select('snapshot').eq('season_id', before!.id).single();
    expect(results!.snapshot.champion).toBeTruthy();

    const { data: intermission } = await adminClient
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'intermission')
      .single();
    expect(intermission).toBeTruthy();
  });

  test('the sweep recorded no failures doing it', async () => {
    const { data: failures, error } = await adminClient.rpc('get_sweep_failures');
    expect(error).toBeNull();

    // Scoped to this group: the suite runs against a shared project, so an
    // unrelated stuck row from another run must not fail this assertion.
    const mine = (failures ?? []).filter((f: { subject_id: string }) => f.subject_id === group.id);
    expect(mine).toEqual([]);
  });
});

describe('one group per iteration: the auto-end sweep is not all-or-nothing', () => {
  let users: Record<string, TestUser>;
  let groupA: GroupRow;
  let groupB: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('taem', ['ownerA', 'memberA', 'ownerB', 'memberB']);
    groupA = await setupGroup(users.ownerA, [users.memberA], { seedAmount: 1000, seasonsEnabled: true, seasonLength: '1m' });
    groupB = await setupGroup(users.ownerB, [users.memberB], { seedAmount: 1000, seasonsEnabled: true, seasonLength: '1m' });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('two groups due at once both end in a single run', async () => {
    const seasonOf = async (groupId: string) => {
      const { data } = await adminClient.from('seasons').select('id').eq('group_id', groupId).eq('status', 'active').single();
      return data!.id as string;
    };

    const seasonA = await seasonOf(groupA.id);
    const seasonB = await seasonOf(groupB.id);
    await backdate('seasons', 'id', seasonA, 'ends_at', 1);
    await backdate('seasons', 'id', seasonB, 'ends_at', 1);

    const { error } = await adminClient.rpc('expire_stale');
    expect(error).toBeNull();

    const { data: after } = await adminClient.from('seasons').select('id, status').in('id', [seasonA, seasonB]);
    expect(after!.map((s) => s.status).sort()).toEqual(['archived', 'archived']);
  });
});

describe('end_season keeps its authorization gate after the split', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('esg', ['owner', 'member', 'outsider']);
    group = await setupGroup(users.owner, [users.member], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  // The work moved into _end_season() and end_season() became the gate in
  // front of it. These are the two ways that refactor could have gone wrong.
  test('a member who is not the owner is refused', async () => {
    const { error } = await users.member.client.rpc('end_season', { p_group_id: group.id });
    expect(error?.message).toMatch(/only the group owner/);

    const { data: season } = await adminClient.from('seasons').select('status').eq('group_id', group.id).eq('status', 'active').single();
    expect(season!.status).toBe('active');
  });

  test('a non-member gets not_found, never forbidden', async () => {
    const { error } = await users.outsider.client.rpc('end_season', { p_group_id: group.id });
    expect(error?.message).toMatch(/not_found/);
    expect(error?.message).not.toMatch(/forbidden/);
  });

  test('the owner can still end it', async () => {
    const { error } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
    expect(error).toBeNull();

    const { data: intermission } = await adminClient
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'intermission')
      .single();
    expect(intermission).toBeTruthy();
  });
});
