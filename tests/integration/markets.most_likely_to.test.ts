import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, fastForwardCloseTime, sleep, type GroupRow } from './helpers/scenarios';

interface MarketOptionRow {
  id: string;
  label: string;
  sort_order: number;
}

// Same floor markets.multiple_choice.test.ts uses: sponsor_market() refuses to endorse inside
// the last 5 minutes before closes_at, so every market is created with headroom and tests that
// want it to close soon call fastForwardCloseTime() after sponsoring.
const SAFE_SPONSOR_WINDOW_MS = 6 * 60_000;

async function createMltMarket(
  creator: TestUser,
  groupId: string,
  options: string[],
  closesInMs = 2000,
  subjectIds: string[] = []
) {
  return creator.client.rpc('create_market', {
    p_group_id: groupId,
    p_title: `Most likely to ${Date.now()}-${Math.random()}`,
    p_description: 'Integration test market',
    p_market_type: 'most_likely_to',
    p_closes_at: new Date(Date.now() + Math.max(closesInMs, SAFE_SPONSOR_WINDOW_MS)).toISOString(),
    p_line: null,
    p_subject_user_ids: subjectIds,
    p_options: options,
  });
}

async function mustCreate(creator: TestUser, groupId: string, options: string[], closesInMs = 2000) {
  const { data, error } = await createMltMarket(creator, groupId, options, closesInMs);
  if (error || !data) throw new Error(`createMltMarket: ${error?.message}`);
  return (Array.isArray(data) ? data[0] : data) as { id: string; status: string; market_type: string };
}

async function getOptions(marketId: string): Promise<MarketOptionRow[]> {
  const { data, error } = await adminClient.from('market_options').select('id, label, sort_order').eq('market_id', marketId).order('sort_order');
  if (error) throw error;
  return data!;
}

async function getBets(marketId: string) {
  const { data, error } = await adminClient.from('bets').select('id, user_id, side, option_id, amount, payout, settled_at').eq('market_id', marketId);
  if (error) throw error;
  return data!;
}

async function subscribe(user: TestUser) {
  const { error } = await adminClient
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint: `https://example.com/push/${user.id}`, p256dh: 'p256dh', auth_key: 'auth-key' }, { onConflict: 'user_id,endpoint' });
  if (error) throw error;
}

describe('most likely to markets', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    // 7 members, so the shared subject cap (member_count - 2) allows 5 named members.
    users = await createTestUsers('mlt', ['owner', 'sponsor', 'a', 'b', 'c', 's1', 's2']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.c, users.s1, users.s2], { seedAmount: 10000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('one option per picked member, each the subject of their own option, and market_opened_about_you reaches all of them on endorsement', async () => {
    await subscribe(users.s1);
    await subscribe(users.s2);

    const market = await mustCreate(users.owner, group.id, ['@s1', '@s2'], 60000);
    expect(market.market_type).toBe('most_likely_to');
    expect(market.status).toBe('pending_sponsor');

    const options = await getOptions(market.id);
    expect(options.map((o) => o.label)).toEqual(['@s1', '@s2']);

    const { data: subjects } = await adminClient.from('market_subjects').select('user_id, option_id').eq('market_id', market.id);
    expect(subjects!.map((s) => s.user_id).sort()).toEqual([users.s1.id, users.s2.id].sort());
    expect(subjects!.find((s) => s.user_id === users.s1.id)!.option_id).toBe(options.find((o) => o.label === '@s1')!.id);
    expect(subjects!.find((s) => s.user_id === users.s2.id)!.option_id).toBe(options.find((o) => o.label === '@s2')!.id);

    const { error: sponsorErr } = await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    expect(sponsorErr).toBeNull();

    const { data: event, error: eventErr } = await adminClient
      .from('notification_events')
      .select('id, market_id')
      .eq('event_type', 'market_opened_about_you')
      .eq('market_id', market.id)
      .single();
    expect(eventErr).toBeNull();
    const { data: recipients, error: recipientsErr } = await adminClient.rpc('get_event_recipients', { p_event_id: event!.id });
    expect(recipientsErr).toBeNull();
    expect((recipients as { user_id: string }[]).map((r) => r.user_id).sort()).toEqual([users.s1.id, users.s2.id].sort());
  });

  test('rejects a plain-text option, the creator naming themselves, an About subject on top of the picks, and more picks than the subject cap', async () => {
    const { error: plainErr } = await createMltMarket(users.owner, group.id, ['@s1', 'Someone else']);
    expect(plainErr?.message).toMatch(/^invalid_operation.*member of the group/);

    const { error: selfErr } = await createMltMarket(users.owner, group.id, ['@s1', '@owner']);
    expect(selfErr?.message).toMatch(/^invalid_operation/);

    const { error: aboutErr } = await createMltMarket(users.owner, group.id, ['@s1', '@s2'], 2000, [users.a.id]);
    expect(aboutErr?.message).toMatch(/^invalid_operation/);

    const { error: overCapErr } = await createMltMarket(users.owner, group.id, ['@sponsor', '@a', '@b', '@c', '@s1', '@s2']);
    expect(overCapErr?.message).toMatch(/^invalid_operation/);

    const { error: atCapErr } = await createMltMarket(users.owner, group.id, ['@a', '@b', '@c', '@s1', '@s2']);
    expect(atCapErr).toBeNull();

    const { error: tooFewErr } = await createMltMarket(users.owner, group.id, ['@s1']);
    expect(tooFewErr?.message).toMatch(/^invalid_operation/);
  });

  test('every named member gets the same 404 as any other subject before resolution, a non-named member sees it throughout, the pool conserves, and the named members see it at reveal', async () => {
    const market = await mustCreate(users.owner, group.id, ['@s1', '@s2']);
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 2000);
    const options = await getOptions(market.id);

    // hidden from both named members while open
    for (const named of [users.s1, users.s2]) {
      const { data: hidden } = await named.client.from('visible_markets').select('id').eq('id', market.id);
      expect(hidden).toEqual([]);
      const { data: hiddenOptions } = await named.client.from('market_options').select('id').eq('market_id', market.id);
      expect(hiddenOptions).toEqual([]);
      const { error: betErr } = await named.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 1, p_option_id: options[0].id });
      expect(betErr?.message).toMatch(/^not_found/);
      // the sealed pulse works (it's the one sanctioned crack), the per-side breakdown does not
      const { data: pulse, error: pulseErr } = await named.client.rpc('get_subject_market_pulse', { p_market_id: market.id }).maybeSingle();
      expect(pulseErr).toBeNull();
      expect(pulse).toMatchObject({ market_type: 'most_likely_to', status: 'open' });
      const { error: sidesErr } = await named.client.rpc('get_subject_market_pulse_sides', { p_market_id: market.id });
      expect(sidesErr?.message).toMatch(/^invalid_operation/);
    }

    // a non-named member sees it and can bet, on either member
    const { data: seen } = await users.a.client.from('visible_markets').select('id, status').eq('id', market.id);
    expect(seen).toHaveLength(1);

    const amounts: number[] = [];
    for (const [bettor, option] of [
      [users.a, options[0]],
      [users.b, options[1]],
      [users.c, options[0]],
    ] as const) {
      const amount = Math.floor(Math.random() * 200) + 1;
      const { error } = await bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: amount, p_option_id: option.id });
      expect(error).toBeNull();
      amounts.push(amount);
    }
    const totalStaked = amounts.reduce((s, a) => s + a, 0);

    await sleep(3000);
    await adminClient.rpc('expire_stale');

    // still hidden while closed
    const { data: hiddenClosed } = await users.s1.client.from('visible_markets').select('id').eq('id', market.id);
    expect(hiddenClosed).toEqual([]);
    const { error: oddsErr } = await users.s2.client.rpc('get_closed_odds_options', { p_market_id: market.id });
    expect(oddsErr?.message).toMatch(/^not_found/);
    const { data: hiddenBets } = await users.s1.client.from('bets').select('id').eq('market_id', market.id);
    expect(hiddenBets).toEqual([]);
    // and the closed odds work for everyone else, per option
    const { data: odds, error: aOddsErr } = await users.a.client.rpc('get_closed_odds_options', { p_market_id: market.id });
    expect(aOddsErr).toBeNull();
    expect(odds).toHaveLength(2);

    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: null,
      p_justification: null,
      p_actual_value: null,
      p_option_id: options[0].id,
    });
    // still hidden while proposed
    const { data: hiddenProposed } = await users.s2.client.from('visible_markets').select('id').eq('id', market.id);
    expect(hiddenProposed).toEqual([]);

    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { data: finalized, error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();
    const resolved = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome_option_id).toBe(options[0].id);

    const bets = await getBets(market.id);
    expect(bets.every((b) => b.settled_at !== null)).toBe(true);
    expect(bets.reduce((s, b) => s + (b.payout ?? 0), 0)).toBe(totalStaked);
    expect(bets.filter((b) => b.option_id !== options[0].id).every((b) => b.payout === 0)).toBe(true);
    expect(bets.filter((b) => b.option_id === options[0].id).every((b) => (b.payout ?? 0) >= b.amount)).toBe(true);

    // visible to both named members at reveal
    for (const named of [users.s1, users.s2]) {
      const { data: visible } = await named.client.from('visible_markets').select('id, status').eq('id', market.id);
      expect(visible).toHaveLength(1);
      expect(visible![0].status).toBe('resolved');
      const { data: visibleOptions } = await named.client.from('market_options').select('id').eq('market_id', market.id);
      expect(visibleOptions).toHaveLength(2);
      const { data: visibleBets } = await named.client.from('bets').select('id').eq('market_id', market.id);
      expect(visibleBets!.length).toBeGreaterThan(0);
    }
  });
});
