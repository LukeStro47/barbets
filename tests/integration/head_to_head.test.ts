import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

interface HeadToHeadMarket {
  market_id: string;
  title: string;
  a_amount: number;
  a_payout: number;
  a_choice: string;
  b_amount: number;
  b_payout: number;
  b_choice: string;
}

async function membershipId(groupId: string, userId: string): Promise<string> {
  const { data, error } = await adminClient.from('memberships').select('id').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data!.id;
}

describe('get_head_to_head_markets', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let marketTitle: string;

  beforeAll(async () => {
    users = await createTestUsers('h2h', ['owner', 'sponsor', 'a', 'b']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b], { seedAmount: 1000 });

    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 60000);
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 50 });

    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    await adminClient.rpc('finalize_market', { p_market_id: market.id });

    const { data: marketRow } = await adminClient.from('markets').select('title').eq('id', market.id).single();
    marketTitle = marketRow!.title;
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('shows a shared market with each side\'s real choice and payout', async () => {
    const aId = await membershipId(group.id, users.a.id);
    const bId = await membershipId(group.id, users.b.id);

    const { data, error } = await users.owner.client.rpc('get_head_to_head_markets', {
      p_membership_id_a: aId,
      p_membership_id_b: bId,
    });
    expect(error).toBeNull();
    const rows = data as HeadToHeadMarket[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.title).toBe(marketTitle);
    expect(row.a_choice).toBe('yes');
    expect(row.b_choice).toBe('no');
    expect(Number(row.a_payout)).toBeGreaterThan(Number(row.a_amount));
    expect(Number(row.b_payout)).toBe(0);
  });

  test('a non-member of the group gets not_found', async () => {
    const outsider = await createTestUsers('h2hout', ['x']);
    try {
      const aId = await membershipId(group.id, users.a.id);
      const bId = await membershipId(group.id, users.b.id);
      const { error } = await outsider.x.client.rpc('get_head_to_head_markets', {
        p_membership_id_a: aId,
        p_membership_id_b: bId,
      });
      expect(error?.message).toMatch(/not_found/);
    } finally {
      await cleanupTestUsers(outsider);
    }
  });

  test('two memberships from different groups is not_found, not a cross-group leak', async () => {
    const otherUsers = await createTestUsers('h2hb', ['owner2', 'c']);
    try {
      const otherGroup = await setupGroup(otherUsers.owner2, [otherUsers.c]);
      const aId = await membershipId(group.id, users.a.id);
      const cId = await membershipId(otherGroup.id, otherUsers.c.id);

      const { error } = await users.owner.client.rpc('get_head_to_head_markets', {
        p_membership_id_a: aId,
        p_membership_id_b: cId,
      });
      expect(error?.message).toMatch(/not_found/);
    } finally {
      await cleanupTestUsers(otherUsers);
    }
  });

  test('a removed member cannot be compared', async () => {
    const removable = await createTestUsers('h2hrm', ['toremove']);
    try {
      const { error: joinErr } = await removable.toremove.client.rpc('join_group', {
        p_invite_code: group.invite_code,
        p_nickname: removable.toremove.tag,
      });
      expect(joinErr).toBeNull();
      const removedId = await membershipId(group.id, removable.toremove.id);
      await users.owner.client.rpc('remove_member', { p_group_id: group.id, p_target_user_id: removable.toremove.id });

      const aId = await membershipId(group.id, users.a.id);
      const { error } = await users.owner.client.rpc('get_head_to_head_markets', {
        p_membership_id_a: aId,
        p_membership_id_b: removedId,
      });
      expect(error?.message).toMatch(/not_found/);
    } finally {
      await cleanupTestUsers(removable);
    }
  });
});
