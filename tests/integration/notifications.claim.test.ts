import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

interface ClaimedEvent {
  id: string;
  event_type: string;
  group_id: string;
  market_id: string | null;
  processed_at: string | null;
}

async function claim(limit: number): Promise<ClaimedEvent[]> {
  const { data, error } = await adminClient.rpc('claim_notification_events', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ClaimedEvent[];
}

/** notification_events is project-wide and shared with every other suite, so each test
 *  here starts from an empty queue. Safe to do: claiming only sets processed_at, it
 *  deletes nothing, and no other test reads that column. */
async function drainQueue() {
  for (;;) {
    const batch = await claim(500);
    if (batch.length < 500) return;
  }
}

describe('claim_notification_events', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('ncl', ['owner', 'a', 'b']);
    group = await setupGroup(users.owner, [users.a, users.b]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('claims an event and marks it processed in the same step', async () => {
    await drainQueue();
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });

    const first = await claim(100);
    const ours = first.filter((e) => e.group_id === group.id);
    expect(ours).toHaveLength(1);
    expect(ours[0].event_type).toBe('market_needs_endorsement');
    expect(ours[0].market_id).toBe(market.id);
    expect(ours[0].processed_at).not.toBeNull();

    // Flagged in the table, not just in the copy that came back.
    const { data: row, error } = await adminClient
      .from('notification_events')
      .select('processed_at')
      .eq('id', ours[0].id)
      .single();
    expect(error).toBeNull();
    expect(row!.processed_at).not.toBeNull();
  });

  test('a second run gets a disjoint slice, so an overrunning run cannot be re-sent', async () => {
    await drainQueue();
    await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await createMarket(users.owner, group.id, { closesInMs: 60000 });

    // p_limit bounds the batch even though more is queued.
    const batch = await claim(2);
    expect(batch).toHaveLength(2);

    const rest = await claim(100);
    const ids = [...batch, ...rest].map((e) => e.id);

    // Nothing came back twice (the double-send this function exists to prevent) and
    // nothing was stranded: all three of our events landed in exactly one slice.
    expect(new Set(ids).size).toBe(ids.length);
    expect([...batch, ...rest].filter((e) => e.group_id === group.id)).toHaveLength(3);

    // And the queue is genuinely empty for our group now, not just skipped over.
    expect((await claim(100)).filter((e) => e.group_id === group.id)).toHaveLength(0);
  });
});
