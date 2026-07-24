import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, sleep, type GroupRow, type MarketRow } from './helpers/scenarios';

describe('row-level security on bets/ledger/push_subscriptions/votes', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('rls', ['owner', 'sponsor', 'a', 'b']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('while a market is open, a member sees only their own bet rows', async () => {
    const market = await createMarket(users.owner, group.id);
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await fastForwardCloseTime(market.id, 2000);
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 15 });
    await users.b.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 25 });

    const { data: aView } = await users.a.client.from('bets').select('user_id, amount').eq('market_id', market.id);
    expect(aView).toHaveLength(1);
    expect(aView![0].user_id).toBe(users.a.id);

    const { data: bView } = await users.b.client.from('bets').select('user_id, amount').eq('market_id', market.id);
    expect(bView).toHaveLength(1);
    expect(bView![0].user_id).toBe(users.b.id);
  });

  test('a member can only ever see their own ledger rows', async () => {
    const { data: ownLedger, error: ownErr } = await users.a.client.from('ledger').select('id').limit(1);
    expect(ownErr).toBeNull();

    const { data: otherAttempt } = await users.b.client
      .from('ledger')
      .select('membership_id')
      .in('membership_id', (ownLedger ?? []).map((r: any) => r.id));
    // b should never be able to read a's ledger rows regardless of id guesses
    expect(otherAttempt).toEqual([]);
  });

  test('ledger is append-only: direct update/delete by an authenticated user is denied', async () => {
    const { data: rows } = await users.a.client.from('ledger').select('id, amount').limit(1);
    expect(rows!.length).toBeGreaterThan(0);
    const row = rows![0];

    const { error: updateErr, data: updateData } = await users.a.client
      .from('ledger')
      .update({ amount: row.amount + 999 })
      .eq('id', row.id)
      .select();
    // RLS with no UPDATE policy denies silently (0 rows affected) rather
    // than a thrown error, or the REVOKE denies it outright — either way,
    // nothing should change.
    expect(updateData ?? []).toEqual([]);

    const { data: unchanged } = await adminClient.from('ledger').select('amount').eq('id', row.id).single();
    expect(unchanged!.amount).toBe(row.amount);
  });

  test('push_subscriptions are strictly own-rows-only', async () => {
    await users.a.client.from('push_subscriptions').insert({
      user_id: users.a.id,
      endpoint: `https://example.com/push/${users.a.id}`,
      p256dh: 'test-p256dh',
      auth_key: 'test-auth-key',
    });

    const { data: bAttempt } = await users.b.client.from('push_subscriptions').select('id').eq('user_id', users.a.id);
    expect(bAttempt).toEqual([]);

    const { data: aOwn } = await users.a.client.from('push_subscriptions').select('id').eq('user_id', users.a.id);
    expect(aOwn!.length).toBe(1);
  });

  describe('vote secrecy', () => {
    let market: MarketRow;

    beforeAll(async () => {
      market = await createMarket(users.owner, group.id, { closesInMs: 1500 });
      await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
      await fastForwardCloseTime(market.id, 1500);
      await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });
      await sleep(2000);
      await adminClient.rpc('expire_stale');
      await users.sponsor.client.rpc('propose_resolution', {
        p_market_id: market.id,
        p_outcome: 'yes',
        p_justification: null,
        p_actual_value: null,
      });
      await users.a.client.rpc('challenge_resolution', { p_market_id: market.id, p_reason: 'test' });
    });

    test('proposals and challenges are visible before the vote closes (not secret)', async () => {
      const { data: proposalView } = await users.b.client
        .from('resolution_proposals')
        .select('id, proposed_outcome')
        .eq('market_id', market.id);
      expect(proposalView).toHaveLength(1);

      const { data: challengeView } = await users.b.client.from('challenges').select('id').eq('market_id', market.id);
      expect(challengeView).toHaveLength(1);
    });

    test('a voter sees their own ballot but not others\', until the vote closes', async () => {
      await users.a.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
      await users.b.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'no' });

      const { data: aSeesOwn } = await users.a.client.from('votes').select('voter_id, outcome').eq('market_id', market.id);
      expect(aSeesOwn).toHaveLength(1);
      expect(aSeesOwn![0].voter_id).toBe(users.a.id);

      const { data: aSeesAll } = await users.a.client.from('votes').select('voter_id').eq('market_id', market.id).eq('voter_id', users.b.id);
      expect(aSeesAll).toEqual([]);
    });

    test('after finalize, all ballots are revealed to everyone', async () => {
      await backdate('challenges', 'market_id', market.id, 'created_at', 9);
      await adminClient.rpc('finalize_market', { p_market_id: market.id });

      const { data: revealed } = await users.b.client.from('votes').select('voter_id, outcome').eq('market_id', market.id);
      expect(revealed).toHaveLength(2);
      const voterIds = revealed!.map((v: any) => v.voter_id).sort();
      expect(voterIds).toEqual([users.a.id, users.b.id].sort());
    });
  });
});
