import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, sleep, type GroupRow, type MarketRow } from './helpers/scenarios';

async function resolveAndFinalize(proposer: TestUser, market: MarketRow, outcome: string) {
  await sleep(4000);
  await adminClient.rpc('expire_stale'); // open -> closed
  await proposer.client.rpc('propose_resolution', {
    p_market_id: market.id,
    p_outcome: outcome,
    p_justification: null,
    p_actual_value: null,
  });
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

describe('parimutuel payout conservation', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pm', ['owner', 'sponsor', 'a', 'b', 'c', 'd', 'e']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.c, users.d, users.e], {
      seedAmount: 10000,
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('randomized bet distribution: sum(payout) === sum(amount) exactly', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const bettors = [users.a, users.b, users.c, users.d, users.e];
    const amounts: number[] = [];
    const sides: string[] = [];
    for (const bettor of bettors) {
      const amount = Math.floor(Math.random() * 200) + 1;
      // guarantee at least one bet lands on 'yes' so the resolved side always has a winning pool
      const side = bettor === users.a ? 'yes' : Math.random() < 0.5 ? 'yes' : 'no';
      amounts.push(amount);
      sides.push(side);
      const { error } = await bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: side, p_amount: amount });
      expect(error).toBeNull();
    }

    const totalStaked = amounts.reduce((s, a) => s + a, 0);

    await resolveAndFinalize(users.sponsor, market, 'yes');

    const bets = await getBets(market.id);
    expect(bets.every((b) => b.settled_at !== null)).toBe(true);

    const totalPayout = bets.reduce((s, b) => s + (b.payout ?? 0), 0);
    expect(totalPayout).toBe(totalStaked);

    const winners = bets.filter((b) => b.side === 'yes');
    const losers = bets.filter((b) => b.side === 'no');
    expect(losers.every((b) => b.payout === 0)).toBe(true);
    expect(winners.every((b) => (b.payout ?? 0) >= b.amount)).toBe(true);
  });

  test('one-sided market: everyone gets exactly their stake back', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 42 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 17 });

    await resolveAndFinalize(users.sponsor, market, 'yes');

    const bets = await getBets(market.id);
    const a = bets.find((b) => b.user_id === users.a.id)!;
    const b = bets.find((b) => b.user_id === users.b.id)!;
    expect(a.payout).toBe(42);
    expect(b.payout).toBe(17);
  });

  test('winning side has zero bets: full refund of every stake', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 30 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 20 });

    const resolved = await resolveAndFinalize(users.sponsor, market, 'yes');
    expect(resolved.status).toBe('resolved');

    const bets = await getBets(market.id);
    expect(bets.find((b) => b.user_id === users.a.id)!.payout).toBe(30);
    expect(bets.find((b) => b.user_id === users.b.id)!.payout).toBe(20);
  });

  test('explicit VOID outcome: full refund, market status voided', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 15 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 35 });

    const resolved = await resolveAndFinalize(users.sponsor, market, 'void');
    expect(resolved.status).toBe('voided');
    expect(resolved.outcome).toBe('void');

    const bets = await getBets(market.id);
    expect(bets.find((b) => b.user_id === users.a.id)!.payout).toBe(15);
    expect(bets.find((b) => b.user_id === users.b.id)!.payout).toBe(35);
  });

  test('dust goes to the single largest winning stake, tie broken by earliest bet', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 2000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    // A and B tie at 1 token each on the winning side (placed in order:
    // A first), C is the lone loser at 1 token. total_pool=3, winning_pool=2.
    // base_payout = floor(1*3/2) = 1 for both A and B; dust = 3-2 = 1,
    // which must go to A (earliest of the tied largest stakes).
    const { error: aErr } = await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 1 });
    expect(aErr).toBeNull();
    await sleep(50);
    const { error: bErr } = await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 1 });
    expect(bErr).toBeNull();
    const { error: cErr } = await users.c.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 1 });
    expect(cErr).toBeNull();

    await resolveAndFinalize(users.sponsor, market, 'yes');

    const bets = await getBets(market.id);
    const a = bets.find((b) => b.user_id === users.a.id)!;
    const b = bets.find((b) => b.user_id === users.b.id)!;
    const c = bets.find((b) => b.user_id === users.c.id)!;

    expect(a.payout).toBe(2); // 1 base + 1 dust
    expect(b.payout).toBe(1);
    expect(c.payout).toBe(0);
    expect(a.payout! + b.payout! + c.payout!).toBe(3);
  });

  test('broke member (0 balance) can still browse/propose/vote but cannot bet', async () => {
    const solo = await createTestUsers('broke', ['x']);
    try {
      await solo.x.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'broke' });
      // spend down to zero: bet cap is 100%, so a single max bet on an
      // otherwise-empty market takes the whole balance to zero.
      const drain = await createMarket(users.owner, group.id, { closesInMs: 60000 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: drain.id });
      const { data: membership } = await adminClient
        .from('memberships')
        .select('balance')
        .eq('group_id', group.id)
        .eq('user_id', solo.x.id)
        .single();
      const { error: drainErr } = await solo.x.client.rpc('place_bet', {
        p_market_id: drain.id,
        p_side: 'yes',
        p_amount: membership!.balance,
      });
      expect(drainErr).toBeNull();

      const { data: after } = await adminClient
        .from('memberships')
        .select('balance')
        .eq('group_id', group.id)
        .eq('user_id', solo.x.id)
        .single();
      expect(after!.balance).toBe(0);

      // broke: can still create/sponsor/propose/challenge/vote
      const market = await createMarket(solo.x, group.id, { closesInMs: 2000 });
      expect(market.id).toBeTruthy();

      const { error: betErr } = await solo.x.client.rpc('place_bet', {
        p_market_id: drain.id,
        p_side: 'no',
        p_amount: 1,
      });
      expect(betErr?.message).toMatch(/insufficient_balance/);
    } finally {
      await cleanupTestUsers(solo);
    }
  });
});
