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
  await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 25);
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

  test('no other open market: the remainder refunds proportionally to this market\'s own bettors instead', async () => {
    await enableDistribute(users.owner, group.id, 25, 5);

    // marketA and marketB from the previous test are both already resolved
    // by this point, so this is genuinely the only market in the group.
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const ownerBefore = await balance(group.id, users.owner.id);
    const sponsorBefore = await balance(group.id, users.sponsor.id);

    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 100 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 300 });

    const resolved = await resolveAndFinalize(users.sponsor, market, 'yes');
    expect(resolved.status).toBe('resolved');

    expect(await balance(group.id, users.owner.id)).toBe(ownerBefore + 100); // 25% of 400
    expect(await balance(group.id, users.sponsor.id)).toBe(sponsorBefore + 20); // 5% of 400

    // remainder = 400 - 100 - 20 = 280, split proportionally: a gets 70, b gets 210.
    const bets = await getBets(market.id);
    expect(bets.find((b) => b.user_id === users.a.id)!.payout).toBe(70);
    expect(bets.find((b) => b.user_id === users.b.id)!.payout).toBe(210);
  });
});

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

  test('a market carrying bonus_pool settles it to the group owner if it voids with no other open market', async () => {
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

    // Now `recipient` itself voids with no other open market to pass its
    // bonus on to — it must settle to the owner rather than vanish.
    // propose_resolution can fire on a still-open market (see ARCHITECTURE.md),
    // so there's no need to wait for `recipient`'s own close time.
    const { error: proposeErr } = await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: recipient.id,
      p_outcome: 'void',
      p_justification: null,
      p_actual_value: null,
    });
    expect(proposeErr).toBeNull();
    await backdate('resolution_proposals', 'market_id', recipient.id, 'proposed_at', 25);
    const { data, error } = await adminClient.rpc('finalize_market', { p_market_id: recipient.id });
    expect(error).toBeNull();
    const resolvedRecipient = Array.isArray(data) ? data[0] : data;
    expect(resolvedRecipient.status).toBe('voided');

    expect(await bonusPool(recipient.id)).toBe(0);
    expect(await balance(group.id, users.owner.id)).toBe(ownerBefore + recipientBonus);
  });
});
