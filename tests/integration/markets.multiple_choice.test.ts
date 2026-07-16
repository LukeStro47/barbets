import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, sleep, type GroupRow } from './helpers/scenarios';

interface MarketOptionRow {
  id: string;
  label: string;
  sort_order: number;
}

async function createMCMarket(creator: TestUser, groupId: string, options: string[], closesInMs = 2000) {
  const { data, error } = await creator.client.rpc('create_market', {
    p_group_id: groupId,
    p_title: `MC market ${Date.now()}-${Math.random()}`,
    p_description: 'Integration test market',
    p_market_type: 'multiple_choice',
    p_closes_at: new Date(Date.now() + closesInMs).toISOString(),
    p_line: null,
    p_subject_user_ids: [],
    p_options: options,
  });
  if (error || !data) throw new Error(`createMCMarket: ${error?.message}`);
  return (Array.isArray(data) ? data[0] : data) as { id: string; status: string };
}

async function getOptions(marketId: string): Promise<MarketOptionRow[]> {
  const { data, error } = await adminClient.from('market_options').select('id, label, sort_order').eq('market_id', marketId).order('sort_order');
  if (error) throw error;
  return data!;
}

async function getBets(marketId: string) {
  const { data, error } = await adminClient
    .from('bets')
    .select('id, user_id, side, option_id, amount, payout, settled_at')
    .eq('market_id', marketId);
  if (error) throw error;
  return data!;
}

describe('multiple choice markets', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('mc', ['owner', 'sponsor', 'a', 'b', 'c', 'd', 'e', 'subj']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.c, users.d, users.e, users.subj], {
      seedAmount: 10000,
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('randomized bet distribution across N options: sum(payout) === sum(amount) exactly', async () => {
    const labels = ['Dan', 'Priya', 'Sam', 'Jo', 'Someone else'];
    const market = await createMCMarket(users.owner, group.id, labels);
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    const options = await getOptions(market.id);

    const bettors = [users.a, users.b, users.c, users.d, users.e];
    const amounts: number[] = [];
    for (const bettor of bettors) {
      const amount = Math.floor(Math.random() * 200) + 1;
      const option = options[Math.floor(Math.random() * options.length)];
      amounts.push(amount);
      const { error } = await bettor.client.rpc('place_bet', {
        p_market_id: market.id,
        p_side: null,
        p_amount: amount,
        p_option_id: option.id,
      });
      expect(error).toBeNull();
    }
    // guarantee at least one bet on the winning option
    const { error: guaranteeErr } = await users.owner.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: null,
      p_amount: 5,
      p_option_id: options[0].id,
    });
    expect(guaranteeErr).toBeNull();
    amounts.push(5);

    const totalStaked = amounts.reduce((s, a) => s + a, 0);

    await sleep(3000);
    await adminClient.rpc('expire_stale');
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: null,
      p_justification: null,
      p_actual_value: null,
      p_option_id: options[0].id,
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { data: finalized, error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();
    const resolved = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome_option_id).toBe(options[0].id);

    const bets = await getBets(market.id);
    expect(bets.every((b) => b.settled_at !== null)).toBe(true);
    const totalPayout = bets.reduce((s, b) => s + (b.payout ?? 0), 0);
    expect(totalPayout).toBe(totalStaked);

    const winners = bets.filter((b) => b.option_id === options[0].id);
    const losers = bets.filter((b) => b.option_id !== options[0].id);
    expect(losers.every((b) => b.payout === 0)).toBe(true);
    expect(winners.every((b) => (b.payout ?? 0) >= b.amount)).toBe(true);
  });

  test('winning option has zero bets: full refund of every stake', async () => {
    const market = await createMCMarket(users.owner, group.id, ['A', 'B', 'C']);
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    const options = await getOptions(market.id);

    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 30, p_option_id: options[0].id });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 20, p_option_id: options[1].id });

    await sleep(3000);
    await adminClient.rpc('expire_stale');
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: null,
      p_justification: null,
      p_actual_value: null,
      p_option_id: options[2].id, // nobody bet on C
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { data: finalized } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    const resolved = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(resolved.status).toBe('resolved');

    const bets = await getBets(market.id);
    expect(bets.find((b) => b.user_id === users.a.id)!.payout).toBe(30);
    expect(bets.find((b) => b.user_id === users.b.id)!.payout).toBe(20);
  });

  test('hedged bettor across two options settles correctly: one wins, one loses, net payout right', async () => {
    const market = await createMCMarket(users.owner, group.id, ['A', 'B', 'C']);
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    const options = await getOptions(market.id);

    // hedged bettor (a) bets on both A and B; c bets on B too so B has a real pool.
    const { error: aOnA } = await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 40, p_option_id: options[0].id });
    expect(aOnA).toBeNull();
    const { error: aOnB } = await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 60, p_option_id: options[1].id });
    expect(aOnB).toBeNull();
    const { error: cOnB } = await users.c.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 100, p_option_id: options[1].id });
    expect(cOnB).toBeNull();

    await sleep(3000);
    await adminClient.rpc('expire_stale');
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: null,
      p_justification: null,
      p_actual_value: null,
      p_option_id: options[1].id, // B wins
    });
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    await adminClient.rpc('finalize_market', { p_market_id: market.id });

    const bets = await getBets(market.id);
    const aLosingBet = bets.find((b) => b.user_id === users.a.id && b.option_id === options[0].id)!;
    const aWinningBet = bets.find((b) => b.user_id === users.a.id && b.option_id === options[1].id)!;
    const cBet = bets.find((b) => b.user_id === users.c.id)!;

    expect(aLosingBet.payout).toBe(0);
    // total pool = 40+60+100 = 200, winning pool (B) = 60+100 = 160
    // a's winning bet: floor(60*200/160) = 75
    expect(aWinningBet.payout).toBe(75);
    expect(cBet.payout).toBe(125); // floor(100*200/160) = 125; 75+125=200, no dust here
    // net across both of a's bets: staked 100 total (40 losing + 60 winning), got 75 back
    expect(aWinningBet.payout! + aLosingBet.payout! - (aLosingBet.amount + aWinningBet.amount)).toBe(-25);
  });

  test('hedging can be turned off per group: a bet on a different option is rejected, a top-up on the same option is not', async () => {
    const settingsOff = {
      p_group_id: group.id,
      p_seed_amount: 10000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
    };
    const { error: offErr } = await users.owner.client.rpc('update_group_settings', { ...settingsOff, p_allow_hedged_bets: false });
    expect(offErr).toBeNull();

    try {
      const market = await createMCMarket(users.owner, group.id, ['A', 'B']);
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      const options = await getOptions(market.id);

      const { error: firstBet } = await users.a.client.rpc('place_bet', {
        p_market_id: market.id,
        p_side: null,
        p_amount: 20,
        p_option_id: options[0].id,
      });
      expect(firstBet).toBeNull();

      const { error: differentOptionErr } = await users.a.client.rpc('place_bet', {
        p_market_id: market.id,
        p_side: null,
        p_amount: 10,
        p_option_id: options[1].id,
      });
      expect(differentOptionErr?.message).toMatch(/invalid_operation/);

      const { error: topUpErr } = await users.a.client.rpc('place_bet', {
        p_market_id: market.id,
        p_side: null,
        p_amount: 15,
        p_option_id: options[0].id,
      });
      expect(topUpErr).toBeNull();
    } finally {
      const { error: onErr } = await users.owner.client.rpc('update_group_settings', { ...settingsOff, p_allow_hedged_bets: true });
      expect(onErr).toBeNull();
    }
  });

  test('bets with mismatched side/option_id are rejected at the constraint level', async () => {
    const market = await createMCMarket(users.owner, group.id, ['A', 'B']);
    const options = await getOptions(market.id);

    const { error: bothSetErr } = await adminClient
      .from('bets')
      .insert({ market_id: market.id, user_id: users.a.id, side: 'yes', option_id: options[0].id, amount: 1 });
    expect(bothSetErr).not.toBeNull();
    expect(bothSetErr?.message).toMatch(/bets_side_xor_option/);

    const { error: neitherSetErr } = await adminClient
      .from('bets')
      .insert({ market_id: market.id, user_id: users.a.id, side: null, option_id: null, amount: 1 });
    expect(neitherSetErr).not.toBeNull();
    expect(neitherSetErr?.message).toMatch(/bets_side_xor_option/);
  });

  test('creator cannot be a subject of any option', async () => {
    const { error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'invalid',
      p_description: 'invalid',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
      p_options: ['A', '@owner'],
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('sponsor cannot be a subject of any option', async () => {
    const market = await createMCMarket(users.owner, group.id, ['A', '@sponsor']);
    const { error } = await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    expect(error?.message).toMatch(/^not_found/);
  });

  test('subject-count cap applies to the union of distinct users across all options', async () => {
    // group has 8 members; cap allows up to 6 subjects (8 - 2), one @mention per option.
    const { error: atCapErr } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'at cap',
      p_description: 'valid',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
      p_options: ['@sponsor', '@a', '@b', '@c', '@d', '@e'],
    });
    expect(atCapErr).toBeNull();

    const { error: overCapErr } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'over cap',
      p_description: 'invalid',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
      p_options: ['@sponsor', '@a', '@b', '@c', '@d', '@e', '@subj'],
    });
    expect(overCapErr?.message).toMatch(/invalid_operation/);
  });

  test('a member can only be a subject of one option', async () => {
    // '@a' and '@A' are distinct label text (so they pass the unique-labels
    // check) but resolve to the same nickname case-insensitively.
    const { error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'dup subject',
      p_description: 'invalid',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
      p_options: ['@a', '@A'],
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('notification fan-out excludes a per-option subject, and includes them only for the resolved event', async () => {
    await adminClient
      .from('push_subscriptions')
      .upsert(
        { user_id: users.subj.id, endpoint: `https://example.com/push/${users.subj.id}`, p256dh: 'p256dh', auth_key: 'auth-key' },
        { onConflict: 'user_id,endpoint' }
      );

    const market = await createMCMarket(users.owner, group.id, ['A', '@subj', 'C'], 60000);
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const defaultFanout = await adminClient.rpc('get_notification_recipients', { p_market_id: market.id, p_include_subjects: false });
    expect((defaultFanout.data as { user_id: string }[]).map((r) => r.user_id)).not.toContain(users.subj.id);

    const resolvedFanout = await adminClient.rpc('get_notification_recipients', { p_market_id: market.id, p_include_subjects: true });
    expect((resolvedFanout.data as { user_id: string }[]).map((r) => r.user_id)).toContain(users.subj.id);
  });

  describe('per-option subject privacy', () => {
    test('a subject of one option cannot see the market, its options, odds, or bets at any pre-resolved status, but sees everything at reveal', async () => {
      const market = await createMCMarket(users.owner, group.id, ['A', 'B', '@subj'], 2000);
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      const options = await getOptions(market.id);

      // hidden while open
      const { data: hiddenOpen } = await users.subj.client.from('visible_markets').select('id').eq('id', market.id);
      expect(hiddenOpen).toEqual([]);
      const { data: hiddenOptions } = await users.subj.client.from('market_options').select('id').eq('market_id', market.id);
      expect(hiddenOptions).toEqual([]);
      const { error: betErr } = await users.subj.client.rpc('place_bet', {
        p_market_id: market.id,
        p_side: null,
        p_amount: 1,
        p_option_id: options[0].id,
      });
      expect(betErr?.message).toMatch(/^not_found/);

      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 10, p_option_id: options[0].id });

      await sleep(3000);
      await adminClient.rpc('expire_stale');

      // hidden while closed/proposed/disputed
      const { data: hiddenClosed } = await users.subj.client.from('visible_markets').select('id').eq('id', market.id);
      expect(hiddenClosed).toEqual([]);
      const { error: oddsErr } = await users.subj.client.rpc('get_closed_odds_options', { p_market_id: market.id });
      expect(oddsErr?.message).toMatch(/^not_found/);
      const { data: hiddenBets } = await users.subj.client.from('bets').select('id').eq('market_id', market.id);
      expect(hiddenBets).toEqual([]);

      await users.sponsor.client.rpc('propose_resolution', {
        p_market_id: market.id,
        p_outcome: null,
        p_justification: null,
        p_actual_value: null,
        p_option_id: options[0].id,
      });
      await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
      await adminClient.rpc('finalize_market', { p_market_id: market.id });

      // visible at reveal
      const { data: visibleResolved } = await users.subj.client.from('visible_markets').select('id, status').eq('id', market.id);
      expect(visibleResolved).toHaveLength(1);
      expect(visibleResolved![0].status).toBe('resolved');
      const { data: visibleOptions } = await users.subj.client.from('market_options').select('id').eq('market_id', market.id);
      expect(visibleOptions).toHaveLength(3);
      const { data: visibleBets } = await users.subj.client.from('bets').select('id').eq('market_id', market.id);
      expect(visibleBets!.length).toBeGreaterThan(0);
    });
  });
});
