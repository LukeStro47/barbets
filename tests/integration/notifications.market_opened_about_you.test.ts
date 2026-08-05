import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow, type MarketRow } from './helpers/scenarios';

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

describe('market_opened_about_you: the one deliberate pre-resolution exception for subjects', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('moa', ['owner', 'sponsor', 'subject', 'bystander']);
    group = await setupGroup(users.owner, [users.sponsor, users.subject, users.bystander]);
    for (const u of [users.owner, users.sponsor, users.subject, users.bystander]) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('sponsor_market emits market_opened_about_you, recipients = the subject only', async () => {
    const market = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id], closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const event = await latestEvent('market_opened_about_you', group.id);
    expect(event.market_id).toBe(market.id);

    const recipients = await recipientIds(event.id);
    expect(recipients).toEqual([users.subject.id]);
  });

  test('a market with no subjects never emits market_opened_about_you', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { data, error } = await adminClient
      .from('notification_events')
      .select('id')
      .eq('event_type', 'market_opened_about_you')
      .eq('market_id', market.id);
    if (error) throw error;
    expect(data).toEqual([]);
  });

  test('create_market emits it directly when the group skips endorsement', async () => {
    const { error: settingsErr } = await users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: false,
      p_betting_enabled: true,
      p_accepting_members: true,
      p_require_endorsement: false,
    });
    expect(settingsErr).toBeNull();

    try {
      const market: MarketRow = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id], closesInMs: 60000 });
      expect(market.status).toBe('open');

      const event = await latestEvent('market_opened_about_you', group.id);
      expect(event.market_id).toBe(market.id);
      expect(await recipientIds(event.id)).toEqual([users.subject.id]);
    } finally {
      await users.owner.client.rpc('update_group_settings', {
        p_group_id: group.id,
        p_seed_amount: 1000,
        p_seasons_enabled: false,
        p_betting_enabled: true,
        p_accepting_members: true,
        p_require_endorsement: true,
      });
    }
  });
});

describe('get_subject_market_pulse(_sides): content-free stats for a subject only', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let market: MarketRow;

  beforeAll(async () => {
    users = await createTestUsers('gsp', ['owner', 'sponsor', 'subject', 'bettor']);
    group = await setupGroup(users.owner, [users.sponsor, users.subject, users.bettor]);
    market = await createMarket(users.owner, group.id, { subjectIds: [users.subject.id], closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    const { error: betErr } = await users.bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });
    if (betErr) throw betErr;
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('the subject sees aggregate stats but nothing identifying', async () => {
    const { data, error } = await users.subject.client.rpc('get_subject_market_pulse', { p_market_id: market.id }).maybeSingle();
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: 'open', market_type: 'yes_no', bet_count: 1, pool_amount: 100 });
  });

  test('the subject can see the odds split by side', async () => {
    const { data, error } = await users.subject.client.rpc('get_subject_market_pulse_sides', { p_market_id: market.id });
    expect(error).toBeNull();
    const sides = data as { side: string; pool_amount: number; bet_count: number; pool_percent: number }[];
    expect(sides.sort((a, b) => a.side.localeCompare(b.side))).toEqual([
      { side: 'no', pool_amount: 0, bet_count: 0, pool_percent: 0 },
      { side: 'yes', pool_amount: 100, bet_count: 1, pool_percent: 100 },
    ]);
  });

  test('a non-subject member gets not_found from both functions, same as any other subject-gated call', async () => {
    const { data: pulse, error: pulseErr } = await users.bettor.client.rpc('get_subject_market_pulse', { p_market_id: market.id });
    expect(pulse).toBeNull();
    expect(pulseErr?.message).toMatch(/^not_found/);

    const { data: sides, error: sidesErr } = await users.bettor.client.rpc('get_subject_market_pulse_sides', { p_market_id: market.id });
    expect(sides).toBeNull();
    expect(sidesErr?.message).toMatch(/^not_found/);
  });

  test('once resolved, get_subject_market_pulse declines — the real (now-unblocked) market page is the path from here', async () => {
    // propose_resolution accepts a still-'open' market directly (it locks betting itself the
    // instant the proposal commits) — no need to separately close it first.
    const { error: proposeErr } = await users.owner.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(proposeErr).toBeNull();
    const { data: proposal } = await adminClient.from('resolution_proposals').select('id').eq('market_id', market.id).single();
    await adminClient.from('resolution_proposals').update({ proposed_at: new Date(Date.now() - 9 * 3_600_000).toISOString() }).eq('id', proposal!.id);
    const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
    expect(finalizeErr).toBeNull();

    const { data, error } = await users.subject.client.rpc('get_subject_market_pulse', { p_market_id: market.id });
    expect(data).toBeNull();
    expect(error?.message).toMatch(/^not_found/);

    const { data: visible } = await users.subject.client.from('visible_markets').select('id, status').eq('id', market.id).single();
    expect(visible?.status).toBe('resolved');
  });
});

describe('get_subject_market_pulse_sides: no side breakdown for multiple choice', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('gsm', ['owner', 'sponsor', 'subject']);
    group = await setupGroup(users.owner, [users.sponsor, users.subject]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a multiple_choice market about the subject rejects the sides call, but not the aggregate one', async () => {
    const { data, error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'Test multiple choice market',
      p_description: 'Integration test',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_subject_user_ids: [users.subject.id],
      p_options: ['Option A', 'Option B', 'Option C'],
    });
    if (error) throw error;
    const market = (Array.isArray(data) ? data[0] : data) as MarketRow;
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { data: pulse, error: pulseErr } = await users.subject.client.rpc('get_subject_market_pulse', { p_market_id: market.id }).maybeSingle();
    expect(pulseErr).toBeNull();
    expect(pulse).toMatchObject({ market_type: 'multiple_choice', bet_count: 0, pool_amount: 0 });

    const { data: sides, error: sidesErr } = await users.subject.client.rpc('get_subject_market_pulse_sides', { p_market_id: market.id });
    expect(sides).toBeNull();
    expect(sidesErr?.message).toMatch(/^invalid_operation/);
  });
});
