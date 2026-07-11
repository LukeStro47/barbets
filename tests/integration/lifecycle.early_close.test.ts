import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

describe('early close via early resolution proposal', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('ecls', ['owner', 'a', 'b', 'subject']);
    group = await setupGroup(users.owner, [users.a, users.b, users.subject]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('proposing on an open market closes it early, stamps closed_at, and emits only one notification', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 3_600_000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });

    const { data: beforeBet, error: betErr } = await users.b.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: 'yes',
      p_amount: 5,
    });
    expect(betErr).toBeNull();
    expect(beforeBet).toBeTruthy();

    const { error: proposeErr } = await users.a.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(proposeErr).toBeNull();

    const { data: row } = await adminClient.from('markets').select('status, closed_at, closes_at').eq('id', market.id).single();
    expect(row!.status).toBe('proposed');
    expect(row!.closed_at).not.toBeNull();
    expect(new Date(row!.closed_at!).getTime()).toBeLessThan(new Date(row!.closes_at).getTime());

    // betting must now be rejected with the friendly "not open" message, not a crash
    const { error: lateBetErr } = await users.b.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: 'no',
      p_amount: 1,
    });
    expect(lateBetErr?.message).toMatch(/betting is not open/i);

    // Closing early via a proposal must not also fire a separate "odds are
    // live" push — the proposal notification already implies betting just
    // locked, so market_closed is suppressed on this path (unlike the
    // natural auto-close path, which still emits it since nobody's proposed
    // anything yet at that point).
    const { data: events } = await adminClient
      .from('notification_events')
      .select('event_type')
      .eq('market_id', market.id)
      .order('created_at', { ascending: true });
    expect(events?.filter((e) => e.event_type === 'market_closed')).toHaveLength(0);
    expect(events?.filter((e) => e.event_type === 'resolution_proposed')).toHaveLength(1);
  });

  test('an early proposal by a subject is rejected and reveals nothing', async () => {
    const market = await createMarket(users.owner, group.id, {
      closesInMs: 3_600_000,
      subjectIds: [users.subject.id],
    });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });

    const { error } = await users.subject.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(error?.message).toMatch(/not_found/i);

    const { data: stillOpen } = await adminClient.from('markets').select('status').eq('id', market.id).single();
    expect(stillOpen!.status).toBe('open');
  });

  test('the challenge/finalize window anchors to proposed_at, not closes_at', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 3_600_000 });
    await users.a.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.a.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });

    // closes_at is still an hour away, but the proposal is already 25h old —
    // finalize must succeed anchored off proposed_at, not wait for closes_at.
    await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
    const { data: finalized, error } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(error).toBeNull();
    const row = Array.isArray(finalized) ? finalized[0] : finalized;
    expect(row.status).toBe('resolved');
    expect(row.outcome).toBe('yes');
  });
});
