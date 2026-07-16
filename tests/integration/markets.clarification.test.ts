import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

async function subscribe(user: TestUser) {
  const { error } = await user.client.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: `https://example.com/push/${user.id}`,
    p256dh: 'p256dh',
    auth_key: 'auth-key',
  });
  if (error) throw error;
}

async function latestEvent(eventType: string, groupId: string) {
  const { data, error } = await adminClient
    .from('notification_events')
    .select('id, event_type, market_id, actor_id')
    .eq('event_type', eventType)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

async function recipientIds(eventId: string): Promise<string[]> {
  const { data, error } = await adminClient.rpc('get_event_recipients', { p_event_id: eventId });
  if (error) throw error;
  return (data as { user_id: string }[]).map((r) => r.user_id).sort();
}

describe('resolution criteria clarification requests', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('crq', ['creator', 'sponsor', 'asker', 'subject']);
    group = await setupGroup(users.creator, [users.sponsor, users.asker, users.subject]);
    for (const u of [users.creator, users.sponsor, users.asker, users.subject]) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('the creator cannot request clarification on their own market', async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 60_000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { error } = await users.creator.client.rpc('request_clarification', {
      p_market_id: market.id,
      p_question: 'Should be rejected',
    });
    expect(error?.message).toMatch(/^invalid_operation/);
  });

  test("a subject gets not_found masking, same as every other market-acting function", async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 60_000, subjectIds: [users.subject.id] });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { error } = await users.subject.client.rpc('request_clarification', {
      p_market_id: market.id,
      p_question: 'Can I see this?',
    });
    expect(error?.message).toMatch(/^not_found/);

    const { data: selectRows, error: selectErr } = await users.subject.client
      .from('resolution_clarifications')
      .select('id')
      .eq('market_id', market.id);
    expect(selectErr).toBeNull();
    expect(selectRows).toEqual([]);
  });

  test('a non-creator member can request clarification, and only the creator is notified', async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 60_000, subjectIds: [users.subject.id] });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { data: row, error } = await users.asker.client.rpc('request_clarification', {
      p_market_id: market.id,
      p_question: 'What counts as finishing?',
    });
    expect(error).toBeNull();
    const clarification = Array.isArray(row) ? row[0] : row;
    expect(clarification.requester_id).toBe(users.asker.id);

    const event = await latestEvent('clarification_requested', group.id);
    expect(event.market_id).toBe(market.id);
    expect(event.actor_id).toBe(users.asker.id);

    const recipients = await recipientIds(event.id);
    expect(recipients).toEqual([users.creator.id]);
  });

  test('a non-creator cannot update the criteria', async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 60_000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.asker.client.rpc('request_clarification', { p_market_id: market.id, p_question: 'Unclear' });

    const { error } = await users.sponsor.client.rpc('update_resolution_criteria', {
      p_market_id: market.id,
      p_description: 'Attempted update',
    });
    expect(error?.message).toMatch(/^forbidden/);
  });

  test('the creator cannot update without a pending request', async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 60_000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { error } = await users.creator.client.rpc('update_resolution_criteria', {
      p_market_id: market.id,
      p_description: 'No request to respond to',
    });
    expect(error?.message).toMatch(/^invalid_operation/);
    expect(error?.message).toMatch(/no pending clarification request/);
  });

  test('one update clears every pending request, notifies everyone but the creator (subject excluded), and a fresh request reopens the loop', async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 60_000, subjectIds: [users.subject.id] });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    await users.asker.client.rpc('request_clarification', { p_market_id: market.id, p_question: 'First question' });
    await users.sponsor.client.rpc('request_clarification', { p_market_id: market.id, p_question: 'Second question' });

    const { data: pendingBefore } = await adminClient.from('resolution_clarifications').select('id').eq('market_id', market.id);
    expect(pendingBefore).toHaveLength(2);

    const { data: updated, error } = await users.creator.client.rpc('update_resolution_criteria', {
      p_market_id: market.id,
      p_description: 'Finishing means crossing the line under your own power.',
    });
    expect(error).toBeNull();
    const marketRow = Array.isArray(updated) ? updated[0] : updated;
    expect(marketRow.description).toBe('Finishing means crossing the line under your own power.');

    // Nothing lingers as history once addressed — both rows are gone, not just marked.
    const { data: pendingAfter } = await adminClient.from('resolution_clarifications').select('id').eq('market_id', market.id);
    expect(pendingAfter).toEqual([]);

    const event = await latestEvent('criteria_updated', group.id);
    expect(event.actor_id).toBe(users.creator.id);
    const recipients = await recipientIds(event.id);
    expect(recipients).not.toContain(users.creator.id);
    expect(recipients).not.toContain(users.subject.id);
    expect(recipients).toEqual([users.asker.id, users.sponsor.id].sort());

    // No pending request left, so a second free-standing update is rejected.
    const { error: freeEditErr } = await users.creator.client.rpc('update_resolution_criteria', {
      p_market_id: market.id,
      p_description: 'Sneaking in another edit',
    });
    expect(freeEditErr?.message).toMatch(/no pending clarification request/);

    // A fresh request reopens the loop.
    await users.asker.client.rpc('request_clarification', { p_market_id: market.id, p_question: 'Follow-up question' });
    const { error: secondUpdateErr } = await users.creator.client.rpc('update_resolution_criteria', {
      p_market_id: market.id,
      p_description: 'Even clearer now.',
    });
    expect(secondUpdateErr).toBeNull();
  });

  test('both actions are rejected once the market leaves open, even mid-conversation', async () => {
    const market = await createMarket(users.creator, group.id, { closesInMs: 3_600_000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.asker.client.rpc('request_clarification', { p_market_id: market.id, p_question: 'Still open here' });

    // Early resolution proposal locks betting (and this loop) immediately, without waiting for closes_at.
    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });

    const { error: requestErr } = await users.asker.client.rpc('request_clarification', {
      p_market_id: market.id,
      p_question: 'Too late now',
    });
    expect(requestErr?.message).toMatch(/betting is open/);

    // A pending request still exists from before the close, but the status gate is checked first.
    const { error: updateErr } = await users.creator.client.rpc('update_resolution_criteria', {
      p_market_id: market.id,
      p_description: 'Too late to edit',
    });
    expect(updateErr?.message).toMatch(/betting is open/);
  });
});
