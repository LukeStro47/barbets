import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

interface CustomTitle {
  id: string;
  group_id: string;
  label: string;
  emoji: string;
  metric: string;
  direction: string;
}

async function holderOf(customTitleId: string) {
  const { data, error } = await adminClient
    .from('custom_group_title_holders')
    .select('user_id, stat_value')
    .eq('custom_title_id', customTitleId)
    .single();
  if (error) throw error;
  return data!;
}

function createTitle(caller: TestUser, groupId: string, overrides: Partial<{ label: string; emoji: string; metric: string; direction: string }> = {}) {
  return caller.client.rpc('create_custom_group_title', {
    p_group_id: groupId,
    p_label: overrides.label ?? 'Test Award',
    p_emoji: overrides.emoji ?? '🎯',
    p_metric: overrides.metric ?? 'bet_count',
    p_direction: overrides.direction ?? 'desc',
  });
}

describe('custom_group_titles', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('cgt', ['owner', 'sponsor', 'a', 'b', 'subject']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.subject], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  describe('create_custom_group_title gating', () => {
    test('non-owner member gets forbidden', async () => {
      const { error } = await createTitle(users.a, group.id);
      expect(error?.message).toMatch(/forbidden/);
    });

    test('non-member gets not_found', async () => {
      const outsider = await createTestUsers('cgtout', ['x']);
      try {
        const { error } = await createTitle(outsider.x, group.id);
        expect(error?.message).toMatch(/not_found/);
      } finally {
        await cleanupTestUsers(outsider);
      }
    });

    test('rejects a blank label, a blank emoji, and an over-length label', async () => {
      const { error: blankLabel } = await createTitle(users.owner, group.id, { label: '   ' });
      expect(blankLabel?.message).toMatch(/invalid_operation/);

      const { error: blankEmoji } = await createTitle(users.owner, group.id, { emoji: '' });
      expect(blankEmoji?.message).toMatch(/invalid_operation/);

      const { error: tooLong } = await createTitle(users.owner, group.id, { label: 'x'.repeat(31) });
      expect(tooLong?.message).toMatch(/invalid_operation/);
      expect(tooLong?.message).toMatch(/30 characters/);
    });

    test('owner can create one, and it computes immediately', async () => {
      const { data, error } = await createTitle(users.owner, group.id, { label: 'First Award' });
      expect(error).toBeNull();
      const row = (Array.isArray(data) ? data[0] : data) as CustomTitle;
      expect(row.label).toBe('First Award');

      // Nobody has bet yet, so it should exist as a vacant row rather than have no row at all.
      const holder = await holderOf(row.id);
      expect(holder.user_id).toBeNull();

      await adminClient.rpc('delete_custom_group_title', { p_id: row.id });
    });

    test('caps at 5 per group', async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { data, error } = await createTitle(users.owner, group.id, { label: `Award ${i}` });
        expect(error).toBeNull();
        created.push((Array.isArray(data) ? data[0] : data).id);
      }
      const { error: sixthErr } = await createTitle(users.owner, group.id, { label: 'One too many' });
      expect(sixthErr?.message).toMatch(/invalid_operation/);
      expect(sixthErr?.message).toMatch(/at most 5/);

      for (const id of created) {
        await adminClient.rpc('delete_custom_group_title', { p_id: id });
      }
    });
  });

  describe('_compute_custom_title', () => {
    test('bet_count picks whoever placed the most bets', async () => {
      const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 60000);
      // a places 2 bets (hedging both sides), b places 1.
      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });
      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 5 });
      await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });

      const { data } = await createTitle(users.owner, group.id, { label: 'Bet Count', metric: 'bet_count', direction: 'desc' });
      const row = (Array.isArray(data) ? data[0] : data) as CustomTitle;
      const holder = await holderOf(row.id);
      expect(holder.user_id).toBe(users.a.id);
      expect(Number(holder.stat_value)).toBe(2);

      await adminClient.rpc('delete_custom_group_title', { p_id: row.id });
    });

    test('net picks the real all-time winner, not just whoever bet most', async () => {
      const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 60000);
      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 200 });
      await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 50 });

      await users.sponsor.client.rpc('propose_resolution', { p_market_id: market.id, p_outcome: 'yes', p_justification: null, p_actual_value: null });
      await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
      await adminClient.rpc('finalize_market', { p_market_id: market.id });

      const { data } = await createTitle(users.owner, group.id, { label: 'Net Leader', metric: 'net', direction: 'desc' });
      const row = (Array.isArray(data) ? data[0] : data) as CustomTitle;
      const holder = await holderOf(row.id);
      expect(holder.user_id).toBe(users.a.id);
      expect(Number(holder.stat_value)).toBeGreaterThan(0);

      await adminClient.rpc('delete_custom_group_title', { p_id: row.id });
    });

    test('times_subject only counts a subject once the market has resolved, never while it is still open', async () => {
      const market = await createMarket(users.owner, group.id, { closesInMs: 60000, subjectIds: [users.subject.id] });

      const { data } = await createTitle(users.owner, group.id, { label: 'Most Talked About', metric: 'times_subject', direction: 'desc' });
      const row = (Array.isArray(data) ? data[0] : data) as CustomTitle;

      // Computed at creation time, while the market is still pending_sponsor/open — the subject
      // must not be counted yet, same privacy rule is_market_visible() enforces everywhere else.
      let holder = await holderOf(row.id);
      expect(holder.user_id).toBeNull();

      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 60000);
      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });
      await users.sponsor.client.rpc('propose_resolution', { p_market_id: market.id, p_outcome: 'yes', p_justification: null, p_actual_value: null });
      await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
      await adminClient.rpc('finalize_market', { p_market_id: market.id });

      // Still not recomputed automatically (that only happens every 3rd resolution) — recompute
      // directly, the same internal call _bump_titles_counter makes.
      await adminClient.rpc('_recompute_custom_group_titles', { p_group_id: group.id });
      holder = await holderOf(row.id);
      expect(holder.user_id).toBe(users.subject.id);
      expect(Number(holder.stat_value)).toBe(1);

      await adminClient.rpc('delete_custom_group_title', { p_id: row.id });
    });
  });

  describe('delete_custom_group_title gating', () => {
    test('non-owner cannot delete; owner can', async () => {
      const { data } = await createTitle(users.owner, group.id, { label: 'Deletable' });
      const row = (Array.isArray(data) ? data[0] : data) as CustomTitle;

      const { error: forbiddenErr } = await users.a.client.rpc('delete_custom_group_title', { p_id: row.id });
      expect(forbiddenErr?.message).toMatch(/forbidden/);

      const { error: okErr } = await users.owner.client.rpc('delete_custom_group_title', { p_id: row.id });
      expect(okErr).toBeNull();

      const { data: gone } = await adminClient.from('custom_group_titles').select('id').eq('id', row.id).maybeSingle();
      expect(gone).toBeNull();
    });
  });
});
