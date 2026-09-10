import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, fastForwardCloseTime, sleep, type GroupRow } from './helpers/scenarios';
import { whenBucketLabels } from '../../lib/whenBuckets';

interface MarketOptionRow {
  id: string;
  label: string;
  sort_order: number;
}

// See markets.multiple_choice.test.ts for why every market is created with this much headroom.
const SAFE_SPONSOR_WINDOW_MS = 6 * 60_000;

async function createWhenMarket(creator: TestUser, groupId: string, extra: { p_options?: string[] | null; p_subject_user_ids?: string[] } = {}, closesInMs = 2000) {
  return creator.client.rpc('create_market', {
    p_group_id: groupId,
    p_title: `When market ${Date.now()}-${Math.random()}`,
    p_description: 'Integration test market',
    p_market_type: 'when',
    p_closes_at: new Date(Date.now() + Math.max(closesInMs, SAFE_SPONSOR_WINDOW_MS)).toISOString(),
    p_line: null,
    p_subject_user_ids: extra.p_subject_user_ids ?? [],
    ...(extra.p_options !== undefined ? { p_options: extra.p_options } : {}),
  });
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

/** The four bucket labels for a creation moment, straight from the Postgres helper (service role only). */
async function sqlLabels(at: string, timezone: string): Promise<string[]> {
  const { data, error } = await adminClient.rpc('_when_option_labels', { p_at: at, p_timezone: timezone });
  if (error) throw error;
  return data as string[];
}

describe('when markets', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('whn', ['owner', 'sponsor', 'a', 'b', 'subj']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.subj], { seedAmount: 10000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  describe('the fixed buckets', () => {
    // Fixed creation moments, so the rules are pinned rather than re-derived from today's date.
    const fixtures: { at: string; timezone: string; expected: string[]; why: string }[] = [
      {
        why: 'a plain midweek day: coming Sunday, end of this month',
        at: '2026-09-09T18:00:00Z',
        timezone: 'America/Chicago',
        expected: ['Tonight (by end of Wed Sep 9)', 'This weekend (by Sun Sep 13)', 'This month (by Wed Sep 30)', 'Never (not by Sep 30)'],
      },
      {
        why: "late evening in the group's zone is still today there, even though it's already tomorrow in UTC",
        at: '2026-09-10T03:00:00Z',
        timezone: 'America/Chicago',
        expected: ['Tonight (by end of Wed Sep 9)', 'This weekend (by Sun Sep 13)', 'This month (by Wed Sep 30)', 'Never (not by Sep 30)'],
      },
      {
        why: 'on a Sunday, "this weekend" rolls to the next one instead of collapsing into tonight',
        at: '2026-09-13T12:00:00Z',
        timezone: 'UTC',
        expected: ['Tonight (by end of Sun Sep 13)', 'This weekend (by Sun Sep 20)', 'This month (by Wed Sep 30)', 'Never (not by Sep 30)'],
      },
      {
        why: 'in the last days of a month, "this month" rolls to the end of next month so it still ends after the weekend',
        at: '2026-09-29T12:00:00Z',
        timezone: 'UTC',
        expected: ['Tonight (by end of Tue Sep 29)', 'This weekend (by Sun Oct 4)', 'This month (by Sat Oct 31)', 'Never (not by Oct 31)'],
      },
    ];

    for (const f of fixtures) {
      test(`_when_option_labels: ${f.why}`, async () => {
        expect(await sqlLabels(f.at, f.timezone)).toEqual(f.expected);
      });
    }

    test('the wizard preview in lib/whenBuckets.ts agrees with the Postgres helper on every fixture', async () => {
      for (const f of fixtures) {
        expect(whenBucketLabels(new Date(f.at), f.timezone)).toEqual(await sqlLabels(f.at, f.timezone));
      }
    });
  });

  test('creates exactly the four buckets in order, generated server-side, and rejects custom options', async () => {
    const { data, error } = await createWhenMarket(users.owner, group.id, {}, 60000);
    expect(error).toBeNull();
    const market = (Array.isArray(data) ? data[0] : data) as { id: string; market_type: string };
    expect(market.market_type).toBe('when');

    const options = await getOptions(market.id);
    expect(options.map((o) => o.sort_order)).toEqual([1, 2, 3, 4]);
    expect(options[0].label).toMatch(/^Tonight \(by end of [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}\)$/);
    expect(options[1].label).toMatch(/^This weekend \(by Sun [A-Z][a-z]{2} \d{1,2}\)$/);
    expect(options[2].label).toMatch(/^This month \(by [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}\)$/);
    expect(options[3].label).toMatch(/^Never \(not by [A-Z][a-z]{2} \d{1,2}\)$/);
    expect(options.every((o) => o.label.length <= 40)).toBe(true);

    // an explicit null is fine too; anything with content is not
    const { error: nullErr } = await createWhenMarket(users.owner, group.id, { p_options: null }, 60000);
    expect(nullErr).toBeNull();
    const { error: customErr } = await createWhenMarket(users.owner, group.id, { p_options: ['Soon', 'Later'] });
    expect(customErr?.message).toMatch(/^invalid_operation.*fixed time buckets/);
  });

  test('a when market about someone is hidden from them until it resolves, a bystander sees it throughout, and the pool conserves through finalize', async () => {
    const { data, error } = await createWhenMarket(users.owner, group.id, { p_subject_user_ids: [users.subj.id] });
    expect(error).toBeNull();
    const market = (Array.isArray(data) ? data[0] : data) as { id: string };
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 2000);
    const options = await getOptions(market.id);

    // hidden while open
    const { data: hiddenOpen } = await users.subj.client.from('visible_markets').select('id').eq('id', market.id);
    expect(hiddenOpen).toEqual([]);
    const { data: hiddenOptions } = await users.subj.client.from('market_options').select('id').eq('market_id', market.id);
    expect(hiddenOptions).toEqual([]);
    const { error: betErr } = await users.subj.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: 1, p_option_id: options[0].id });
    expect(betErr?.message).toMatch(/^not_found/);
    const { data: pulse } = await users.subj.client.rpc('get_subject_market_pulse', { p_market_id: market.id }).maybeSingle();
    expect(pulse).toMatchObject({ market_type: 'when', status: 'open' });
    const { error: sidesErr } = await users.subj.client.rpc('get_subject_market_pulse_sides', { p_market_id: market.id });
    expect(sidesErr?.message).toMatch(/^invalid_operation/);

    // a bystander sees it and bets across the buckets
    const { data: seen } = await users.a.client.from('visible_markets').select('id').eq('id', market.id);
    expect(seen).toHaveLength(1);
    const stakes: [TestUser, MarketOptionRow, number][] = [
      [users.a, options[1], 40],
      [users.b, options[3], 25],
      [users.owner, options[1], 10],
    ];
    for (const [bettor, option, amount] of stakes) {
      const { error: placeErr } = await bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: null, p_amount: amount, p_option_id: option.id });
      expect(placeErr).toBeNull();
    }
    const totalStaked = stakes.reduce((s, [, , amount]) => s + amount, 0);

    await sleep(3000);
    await adminClient.rpc('expire_stale');

    // hidden while closed; odds by option for everyone else
    const { data: hiddenClosed } = await users.subj.client.from('visible_markets').select('id').eq('id', market.id);
    expect(hiddenClosed).toEqual([]);
    const { error: subjOddsErr } = await users.subj.client.rpc('get_closed_odds_options', { p_market_id: market.id });
    expect(subjOddsErr?.message).toMatch(/^not_found/);
    const { data: odds, error: oddsErr } = await users.a.client.rpc('get_closed_odds_options', { p_market_id: market.id });
    expect(oddsErr).toBeNull();
    expect(odds).toHaveLength(4);
    const { error: sideOddsErr } = await users.a.client.rpc('get_closed_odds', { p_market_id: market.id });
    expect(sideOddsErr?.message).toMatch(/^invalid_operation/);

    // "this weekend" wins
    const { error: proposeErr } = await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: null,
      p_justification: null,
      p_actual_value: null,
      p_option_id: options[1].id,
    });
    expect(proposeErr).toBeNull();
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { data: finalized, error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();
    const resolved = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome_option_id).toBe(options[1].id);
    expect(resolved.outcome).toBeNull();

    const bets = await getBets(market.id);
    expect(bets.every((b) => b.settled_at !== null)).toBe(true);
    expect(bets.reduce((s, b) => s + (b.payout ?? 0), 0)).toBe(totalStaked);
    // pool 75, winning pool 50: a gets floor(40*75/50) = 60, owner floor(10*75/50) = 15, b nothing
    expect(bets.find((b) => b.user_id === users.a.id)!.payout).toBe(60);
    expect(bets.find((b) => b.user_id === users.owner.id)!.payout).toBe(15);
    expect(bets.find((b) => b.user_id === users.b.id)!.payout).toBe(0);

    // visible to the subject at reveal, buckets and all
    const { data: visible } = await users.subj.client.from('visible_markets').select('id, status, outcome_option_id').eq('id', market.id);
    expect(visible).toHaveLength(1);
    expect(visible![0].status).toBe('resolved');
    const { data: visibleOptions } = await users.subj.client.from('market_options').select('label').eq('market_id', market.id);
    expect(visibleOptions).toHaveLength(4);
  });
});
