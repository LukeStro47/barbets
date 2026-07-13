import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, sleep, type GroupRow, type MarketRow } from './helpers/scenarios';

/** Drives a fresh yes_no market all the way to `resolved` via the unchallenged auto-finalize path (no vote needed). */
async function createResolvedMarket(
  owner: TestUser,
  sponsor: TestUser,
  groupId: string,
  opts: { subjectIds?: string[] } = {}
): Promise<MarketRow> {
  const market = await createMarket(owner, groupId, { subjectIds: opts.subjectIds, closesInMs: 1500 });
  await sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
  await sleep(2000);
  await adminClient.rpc('expire_stale'); // -> closed

  await sponsor.client.rpc('propose_resolution', {
    p_market_id: market.id,
    p_outcome: 'yes',
    p_justification: null,
    p_actual_value: null,
  });
  await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
  await adminClient.rpc('finalize_market', { p_market_id: market.id });

  return market;
}

describe('market reactions', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('rxn', ['owner', 'sponsor', 'subject']);
    group = await setupGroup(users.owner, [users.sponsor, users.subject]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('reacting before a market resolves is rejected', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60_000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { error } = await users.sponsor.client.rpc('react_to_market', { p_market_id: market.id, p_emoji: 'fire' });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('one reaction per person: tapping the same emoji removes it, tapping another swaps it', async () => {
    const market = await createResolvedMarket(users.owner, users.sponsor, group.id);

    const { data: first, error: firstErr } = await users.sponsor.client.rpc('react_to_market', {
      p_market_id: market.id,
      p_emoji: 'fire',
    });
    expect(firstErr).toBeNull();
    expect(first).toBe('fire');

    const { data: rows } = await adminClient.from('market_reactions').select('emoji').eq('market_id', market.id).eq('user_id', users.sponsor.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].emoji).toBe('fire');

    // Tapping the same emoji again clears it.
    const { data: cleared, error: clearedErr } = await users.sponsor.client.rpc('react_to_market', {
      p_market_id: market.id,
      p_emoji: 'fire',
    });
    expect(clearedErr).toBeNull();
    expect(cleared).toBeNull();

    const { data: rowsAfterClear } = await adminClient
      .from('market_reactions')
      .select('emoji')
      .eq('market_id', market.id)
      .eq('user_id', users.sponsor.id);
    expect(rowsAfterClear).toEqual([]);

    // Reacting again, then swapping to a different emoji, leaves exactly one row.
    await users.sponsor.client.rpc('react_to_market', { p_market_id: market.id, p_emoji: 'laugh' });
    const { data: swapped, error: swappedErr } = await users.sponsor.client.rpc('react_to_market', {
      p_market_id: market.id,
      p_emoji: 'clown',
    });
    expect(swappedErr).toBeNull();
    expect(swapped).toBe('clown');

    const { data: rowsAfterSwap } = await adminClient
      .from('market_reactions')
      .select('emoji')
      .eq('market_id', market.id)
      .eq('user_id', users.sponsor.id);
    expect(rowsAfterSwap).toHaveLength(1);
    expect(rowsAfterSwap![0].emoji).toBe('clown');
  });

  test("a market's own subject can react once it resolves, same as anyone else", async () => {
    const market = await createResolvedMarket(users.owner, users.sponsor, group.id, { subjectIds: [users.subject.id] });

    const { data, error } = await users.subject.client.rpc('react_to_market', { p_market_id: market.id, p_emoji: 'salute' });
    expect(error).toBeNull();
    expect(data).toBe('salute');
  });

  test('a non-member of the group gets not_found, never a distinguishable forbidden error', async () => {
    const market = await createResolvedMarket(users.owner, users.sponsor, group.id);
    const outsider = await createTestUsers('rxnout', ['x']);
    try {
      const { error } = await outsider.x.client.rpc('react_to_market', { p_market_id: market.id, p_emoji: 'thumbs_up' });
      expect(error?.message).toMatch(/^not_found/);

      const { data, error: selectErr } = await outsider.x.client.from('market_reactions').select('emoji').eq('market_id', market.id);
      expect(selectErr).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await cleanupTestUsers(outsider);
    }
  });
});
