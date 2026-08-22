import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

interface MemberStats {
  membership_id: string;
  group_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  net: string | number;
  accuracy_pct: number | null;
  settled_bet_count: number;
  tokens_wagered: string | number;
  best_call_multiple: number | null;
  best_call_title: string | null;
}

async function membershipId(groupId: string, userId: string): Promise<string> {
  const { data, error } = await adminClient.from('memberships').select('id').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data!.id;
}

async function getStats(caller: TestUser, targetMembershipId: string) {
  return caller.client.rpc('get_member_stats', { p_membership_id: targetMembershipId });
}

describe('get_member_stats', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('mstat', ['owner', 'sponsor', 'bettor', 'left', 'removed']);
    group = await setupGroup(users.owner, [users.sponsor, users.bettor, users.left, users.removed], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('another active member can see a real win reflected accurately', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    const { error: betErr } = await users.bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });
    expect(betErr).toBeNull();

    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();

    const bettorMembershipId = await membershipId(group.id, users.bettor.id);
    const { data, error } = await getStats(users.owner, bettorMembershipId);
    expect(error).toBeNull();
    const stats = (Array.isArray(data) ? data[0] : data) as MemberStats;

    expect(stats.user_id).toBe(users.bettor.id);
    expect(stats.accuracy_pct).toBe(100);
    expect(stats.settled_bet_count).toBe(1);
    expect(Number(stats.tokens_wagered)).toBe(100);
    expect(Number(stats.net)).toBeGreaterThan(0);
    expect(stats.best_call_multiple).not.toBeNull();
    const { data: marketRow } = await adminClient.from('markets').select('title').eq('id', market.id).single();
    expect(stats.best_call_title).toBe(marketRow!.title);
  });

  test('a non-member of the group gets not_found, not the real stats', async () => {
    const outsider = await createTestUsers('mstatout', ['x']);
    try {
      const bettorMembershipId = await membershipId(group.id, users.bettor.id);
      const { data, error } = await getStats(outsider.x, bettorMembershipId);
      expect(error?.message).toMatch(/not_found/);
      expect(data).toBeNull();
    } finally {
      await cleanupTestUsers(outsider);
    }
  });

  test('a member who left can no longer view anyone (same gate as the rest of the group)', async () => {
    await users.left.client.rpc('leave_group', { p_group_id: group.id });
    const bettorMembershipId = await membershipId(group.id, users.bettor.id);
    const { error } = await getStats(users.left, bettorMembershipId);
    expect(error?.message).toMatch(/not_found/);
  });

  test('a removed member cannot be viewed, even by a legitimate caller', async () => {
    const removedMembershipId = await membershipId(group.id, users.removed.id);
    await users.owner.client.rpc('remove_member', { p_group_id: group.id, p_target_user_id: users.removed.id });
    const { error } = await getStats(users.owner, removedMembershipId);
    expect(error?.message).toMatch(/not_found/);
  });

  test('cross-group isolation: a member of a different group cannot fetch this group\'s stats', async () => {
    const otherUsers = await createTestUsers('mstatb', ['owner2']);
    try {
      await setupGroup(otherUsers.owner2, []);
      const bettorMembershipId = await membershipId(group.id, users.bettor.id);
      const { error } = await getStats(otherUsers.owner2, bettorMembershipId);
      expect(error?.message).toMatch(/not_found/);
    } finally {
      await cleanupTestUsers(otherUsers);
    }
  });
});
