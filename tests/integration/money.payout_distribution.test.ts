import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, sleep, type GroupRow, type MarketRow } from './helpers/scenarios';

async function enableDistribute(owner: TestUser, groupId: string, creatorPct: number, endorserPct: number) {
  const { error } = await owner.client.rpc('update_group_settings', {
    p_group_id: groupId,
    p_seed_amount: 1000,
    p_seasons_enabled: false,
    p_season_length: null,
    p_timezone: 'UTC',
    p_betting_enabled: true,
    p_accepting_members: true,
    p_distribute_payout: true,
    p_creator_payout_pct: creatorPct,
    p_endorser_payout_pct: endorserPct,
  });
  if (error) throw new Error(`enableDistribute: ${error.message}`);
}

async function resolveAndFinalize(proposer: TestUser, market: MarketRow, outcome: string) {
  await sleep(4000);
  await adminClient.rpc('expire_stale'); // open -> closed
  const { error: proposeErr } = await proposer.client.rpc('propose_resolution', {
    p_market_id: market.id,
    p_outcome: outcome,
    p_justification: null,
    p_actual_value: null,
  });
  if (proposeErr) throw new Error(`propose_resolution: ${proposeErr.message}`);
  await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
  const { data, error } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
  if (error) throw new Error(`finalize_market: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

async function getBets(marketId: string) {
  const { data, error } = await adminClient.from('bets').select('id, user_id, side, amount, payout, settled_at').eq('market_id', marketId);
  if (error) throw error;
  return data!;
}

async function balance(groupId: string, userId: string): Promise<number> {
  const { data, error } = await adminClient.from('memberships').select('balance').eq('group_id', groupId).eq('user_id', userId).single();
  if (error) throw error;
  return data!.balance;
}

async function bonusPool(marketId: string): Promise<number> {
  const { data, error } = await adminClient.from('markets').select('bonus_pool').eq('id', marketId).single();
  if (error) throw error;
  return data!.bonus_pool;
}

describe('distribute_payout: zero-winner-pool reward split (opt-in setting)', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('dpo', ['owner', 'sponsor', 'a', 'b', 'c']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.c], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('creator/endorser take their cut and the remainder tops up another open market, absorbed correctly on that market\'s own resolution', async () => {
    await enableDistribute(users.owner, group.id, 20, 10);

    const marketA = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: marketA.id });
    const marketB = await createMarket(users.owner, group.id, { closesInMs: 120000 }); // stays open throughout
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: marketB.id });

    const ownerBefore = await balance(group.id, users.owner.id);
    const sponsorBefore = await balance(group.id, users.sponsor.id);

    await users.a.client.rpc('place_bet', { p_market_id: marketA.id, p_side: 'no', p_amount: 100 });
    await users.b.client.rpc('place_bet', { p_market_id: marketA.id, p_side: 'no', p_amount: 50 });

    // Nobody bet 'yes' — winning_pool = 0, real_pool = 150.
    const resolved = await resolveAndFinalize(users.sponsor, marketA, 'yes');
    expect(resolved.status).toBe('resolved');

    expect(await balance(group.id, users.owner.id)).toBe(ownerBefore + 30); // 20% of 150
    expect(await balance(group.id, users.sponsor.id)).toBe(sponsorBefore + 15); // 10% of 150

    expect(resolved.payout_breakdown).toEqual({
      creator_cut: 30,
      endorser_cut: 15,
      other_markets_cut: 105,
      held_in_group_pool: 0,
    });

    const betsA = await getBets(marketA.id);
    expect(betsA.every((b) => b.payout === 0 && b.settled_at !== null)).toBe(true);

    // remainder = 150 - 30 - 15 = 105, the only other open market gets all of it.
    expect(await bonusPool(marketB.id)).toBe(105);

    // marketB later resolves normally — the bonus folds into its total pool
    // and is absorbed by the winning side exactly like any other stake.
    await users.c.client.rpc('place_bet', { p_market_id: marketB.id, p_side: 'yes', p_amount: 50 });
    const resolvedB = await resolveAndFinalize(users.sponsor, marketB, 'yes');
    expect(resolvedB.status).toBe('resolved');

    const betsB = await getBets(marketB.id);
    const cBet = betsB.find((b) => b.user_id === users.c.id)!;
    expect(cBet.payout).toBe(155); // 50 staked + 105 inherited bonus, sole winner
    expect(await bonusPool(marketB.id)).toBe(0);
  });

  test('no other open market: the remainder holds in the group\'s pending pool, never back to this market\'s own bettors', async () => {
    await enableDistribute(users.owner, group.id, 25, 5);

    // marketA and marketB from the previous test are both already resolved
    // by this point, so this is genuinely the only market in the group.
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const ownerBefore = await balance(group.id, users.owner.id);
    const sponsorBefore = await balance(group.id, users.sponsor.id);
    const pendingBefore = await pendingBonusPool(group.id);

    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 100 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 300 });

    const resolved = await resolveAndFinalize(users.sponsor, market, 'yes');
    expect(resolved.status).toBe('resolved');

    expect(await balance(group.id, users.owner.id)).toBe(ownerBefore + 100); // 25% of 400
    expect(await balance(group.id, users.sponsor.id)).toBe(sponsorBefore + 20); // 5% of 400

    // remainder = 400 - 100 - 20 = 280, held in the group's pending pool —
    // neither bettor gets any of it back, unlike a normal winners split.
    const bets = await getBets(market.id);
    expect(bets.find((b) => b.user_id === users.a.id)!.payout).toBe(0);
    expect(bets.find((b) => b.user_id === users.b.id)!.payout).toBe(0);
    expect(await pendingBonusPool(group.id)).toBe(pendingBefore + 280);

    expect(resolved.payout_breakdown).toEqual({
      creator_cut: 100,
      endorser_cut: 20,
      other_markets_cut: 0,
      held_in_group_pool: 280,
    });
  });
});

async function pendingBonusPool(groupId: string): Promise<number> {
  const { data, error } = await adminClient.from('groups').select('pending_bonus_pool').eq('id', groupId).single();
  if (error) throw error;
  return data!.pending_bonus_pool;
}

describe('bonus_pool never gets orphaned', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('dpv', ['owner', 'sponsor', 'a']);
    group = await setupGroup(users.owner, [users.sponsor, users.a], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a market carrying bonus_pool holds it in the group\'s pending pool if it voids with no other open market', async () => {
    await enableDistribute(users.owner, group.id, 25, 5);

    const source = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: source.id });
    const recipient = await createMarket(users.owner, group.id, { closesInMs: 120000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: recipient.id });

    await users.a.client.rpc('place_bet', { p_market_id: source.id, p_side: 'no', p_amount: 100 });
    await resolveAndFinalize(users.sponsor, source, 'yes'); // winning_pool = 0 -> sends its remainder to `recipient`

    const recipientBonus = await bonusPool(recipient.id);
    expect(recipientBonus).toBeGreaterThan(0);

    const ownerBefore = await balance(group.id, users.owner.id);
    const pendingBefore = await pendingBonusPool(group.id);

    // Now `recipient` itself voids with no other open market to pass its
    // bonus on to — it must hold in the group's pending pool rather than
    // vanish or settle to the owner. propose_resolution can fire on a still-
    // open market (see ARCHITECTURE.md), so there's no need to wait for
    // `recipient`'s own close time.
    const { error: proposeErr } = await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: recipient.id,
      p_outcome: 'void',
      p_justification: null,
      p_actual_value: null,
    });
    expect(proposeErr).toBeNull();
    await backdate('resolution_proposals', 'market_id', recipient.id, 'proposed_at', 9);
    const { data, error } = await adminClient.rpc('finalize_market', { p_market_id: recipient.id });
    expect(error).toBeNull();
    const resolvedRecipient = Array.isArray(data) ? data[0] : data;
    expect(resolvedRecipient.status).toBe('voided');

    expect(await bonusPool(recipient.id)).toBe(0);
    expect(await balance(group.id, users.owner.id)).toBe(ownerBefore); // unchanged, no longer settles to the owner
    expect(await pendingBonusPool(group.id)).toBe(pendingBefore + recipientBonus);
  });

  test('the group\'s pending bonus pool seeds the next market created, and carried_bonus_pool records it', async () => {
    const pending = await pendingBonusPool(group.id);
    expect(pending).toBeGreaterThan(0); // left over from the previous test

    const next = await createMarket(users.owner, group.id, { closesInMs: 120000 });

    expect(await bonusPool(next.id)).toBe(pending);
    const { data, error } = await adminClient.from('markets').select('carried_bonus_pool').eq('id', next.id).single();
    expect(error).toBeNull();
    expect(data!.carried_bonus_pool).toBe(pending);
    expect(await pendingBonusPool(group.id)).toBe(0);
  });
});

describe('pending_bonus_pool at season end', () => {
  test('a leftover pending pool splits evenly across active members when the season ends before any market claims it', async () => {
    const users = await createTestUsers('szb', ['owner', 'sponsor', 'a', 'b']);
    const group = await setupGroup(users.owner, [users.sponsor, users.a, users.b], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'manual',
    });
    try {
      const { error: settingsErr } = await users.owner.client.rpc('update_group_settings', {
        p_group_id: group.id,
        p_seed_amount: 1000,
        p_seasons_enabled: true,
        p_season_length: 'manual',
        p_timezone: 'UTC',
        p_betting_enabled: true,
        p_accepting_members: true,
        p_distribute_payout: true,
        p_creator_payout_pct: 25,
        p_endorser_payout_pct: 5,
      });
      if (settingsErr) throw new Error(`enable distribute: ${settingsErr.message}`);

      const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

      const before: Record<string, number> = {};
      for (const key of ['owner', 'sponsor', 'a', 'b'] as const) {
        before[key] = await balance(group.id, users[key].id);
      }

      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 100 });
      await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 300 });

      // Nobody bet 'yes', and this is the only market in a brand-new group —
      // the remainder (400 - 100 - 20 = 280) holds in pending_bonus_pool.
      await resolveAndFinalize(users.sponsor, market, 'yes');
      expect(await pendingBonusPool(group.id)).toBe(280);

      // Nothing else in flight, so end_season() archives synchronously right
      // away — the fast path, not the winding_down/deferred one — and
      // _finalize_season()'s even split fires in the same call.
      const { error: endErr } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
      expect(endErr).toBeNull();

      expect(await pendingBonusPool(group.id)).toBe(0);

      // 280 split evenly across all 4 active members = 70 each, on top of
      // the creator/endorser cuts owner/sponsor already received.
      expect(await balance(group.id, users.owner.id)).toBe(before.owner + 100 + 70); // 25% of 400 + even split
      expect(await balance(group.id, users.sponsor.id)).toBe(before.sponsor + 20 + 70); // 5% of 400 + even split
      expect(await balance(group.id, users.a.id)).toBe(before.a - 100 + 70); // lost the 100 stake, then the even split
      expect(await balance(group.id, users.b.id)).toBe(before.b - 300 + 70); // lost the 300 stake, then the even split
    } finally {
      await cleanupTestUsers(users);
    }
  });
});
