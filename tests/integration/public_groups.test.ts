import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, fastForwardCloseTime, createMarket, type GroupRow } from './helpers/scenarios';

/** Grants platform-admin authority to a test user directly via the service-role client — same
    zero-policy table create_public_group()/assign_group_moderator() gate on, no app-level flow to
    drive it through. */
async function makeAdmin(user: TestUser): Promise<void> {
  const { error } = await adminClient.from('app_admins').insert({ user_id: user.id });
  if (error) throw new Error(`makeAdmin(${user.tag}): ${error.message}`);
}

interface PublicGroupRow extends GroupRow {
  is_public: boolean;
  category: string;
}

async function createPublicGroup(admin: TestUser, category: 'generic' | 'campus' = 'generic', name?: string) {
  const { data, error } = await admin.client.rpc('create_public_group', {
    p_name: name ?? `Public Test Group ${Date.now()}`,
    p_category: category,
    p_seed_amount: 1000,
    p_nickname: admin.tag,
    p_timezone: 'UTC',
  });
  if (error || !data) throw new Error(`createPublicGroup: ${error?.message}`);
  return (Array.isArray(data) ? data[0] : data) as PublicGroupRow;
}

async function subscribe(user: TestUser) {
  const { error } = await adminClient.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: `https://example.com/push/${user.id}-${Date.now()}`,
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

describe('create_public_group / list_public_groups', () => {
  let users: Record<string, TestUser>;

  beforeAll(async () => {
    users = await createTestUsers('pgcre', ['admin', 'notadmin']);
    await makeAdmin(users.admin);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a non-admin cannot create a public group', async () => {
    const { error } = await users.notadmin.client.rpc('create_public_group', {
      p_name: 'Should fail',
      p_category: 'generic',
      p_seed_amount: 1000,
      p_nickname: 'nope',
      p_timezone: 'UTC',
    });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('an admin creates a public group, becomes its owner and first member, with awards forced off', async () => {
    const group = await createPublicGroup(users.admin, 'campus');
    expect(group.owner_id).toBe(users.admin.id);
    expect(group.is_public).toBe(true);
    expect(group.category).toBe('campus');

    const { data: settings } = await adminClient.from('group_settings').select('awards_enabled, betting_enabled').eq('group_id', group.id).single();
    expect(settings!.awards_enabled).toBe(false);
    expect(settings!.betting_enabled).toBe(true);

    const { data: membership } = await adminClient.from('memberships').select('balance, status, role').eq('group_id', group.id).eq('user_id', users.admin.id).single();
    expect(membership!.balance).toBe(1000);
    expect(membership!.status).toBe('active');
    // createPublicGroup() (the test helper above) always passes a nickname, which is the "I'll
    // moderate this too" opt-in — role='moderator' alongside the owner authority they already
    // have via groups.owner_id, not a substitute for it.
    expect(membership!.role).toBe('moderator');
  });

  test('a nickname-less create_public_group call gives the admin no membership at all', async () => {
    const { data, error } = await users.admin.client.rpc('create_public_group', {
      p_name: `No-join test ${Date.now()}`,
      p_category: 'generic',
      p_seed_amount: 1000,
      p_timezone: 'UTC',
    });
    expect(error).toBeNull();
    const group = (Array.isArray(data) ? data[0] : data) as PublicGroupRow;

    const { data: membership } = await adminClient.from('memberships').select('id').eq('group_id', group.id).eq('user_id', users.admin.id).maybeSingle();
    expect(membership).toBeNull();

    // The owner can still manage the group they didn't join — see update_group_settings()'s
    // is_public branch.
    const { error: settingsErr } = await users.admin.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 2000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
    });
    expect(settingsErr).toBeNull();
  });

  test('update_group_settings forces awards_enabled off for a public group regardless of what is submitted', async () => {
    const group = await createPublicGroup(users.admin);
    const { error } = await users.admin.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
      p_awards_enabled: true, // attempting to turn it on
    });
    expect(error).toBeNull();
    const { data: settings } = await adminClient.from('group_settings').select('awards_enabled').eq('group_id', group.id).single();
    expect(settings!.awards_enabled).toBe(false);
  });

  test('list_public_groups surfaces the public group but never a private one', async () => {
    const publicGroup = await createPublicGroup(users.admin);
    const privateGroup = await setupGroup(users.admin, []);

    const { data, error } = await users.notadmin.client.rpc('list_public_groups');
    expect(error).toBeNull();
    const ids = (data ?? []).map((g: { id: string }) => g.id);
    expect(ids).toContain(publicGroup.id);
    expect(ids).not.toContain(privateGroup.id);
  });
});

describe('join_public_group', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgjoin', ['admin', 'a', 'b']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('joining a private group by id (no invite code) is a clean not_found, not a second door in', async () => {
    const privateGroup = await setupGroup(users.admin, []);
    const { error } = await users.a.client.rpc('join_public_group', { p_group_id: privateGroup.id, p_nickname: 'a' });
    expect(error?.message).toMatch(/not_found/);
  });

  test('a stranger joins instantly, no invite code needed', async () => {
    const { data, error } = await users.a.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pga' });
    expect(error).toBeNull();
    const membership = Array.isArray(data) ? data[0] : data;
    expect(membership.status).toBe('active');
    expect(membership.balance).toBe(1000);
  });

  test('re-joining (already an active member) is idempotent, same as join_group', async () => {
    const { data, error } = await users.a.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'irrelevant' });
    expect(error).toBeNull();
    const membership = Array.isArray(data) ? data[0] : data;
    expect(membership.nickname).toBe('pga'); // untouched, not overwritten by the second call's nickname
  });

  test('accepting_members is a fixed-on hard rule for a public group, not owner-configurable', async () => {
    // update_group_settings() coerces this back to true for a public group regardless of what's
    // submitted (see 20260825100000) — a directory-joined group has no "pause invites" concept,
    // the listing itself is the only gate. Confirm the coercion holds, then confirm a genuinely
    // new join still succeeds.
    const { error: settingsErr } = await users.admin.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: false,
    });
    expect(settingsErr).toBeNull();

    const { data: settings } = await adminClient.from('group_settings').select('accepting_members').eq('group_id', group.id).single();
    expect(settings!.accepting_members).toBe(true);

    const { error: joinErr } = await users.b.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgb' });
    expect(joinErr).toBeNull();
  });
});

describe('public group market gates: mod-only creation, no subjects', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pggate', ['admin', 'member', 'other']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
    await users.member.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'member' });
    await users.other.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'other' });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a regular member cannot hand-create a market', async () => {
    const { error } = await users.member.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'Should fail',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error?.message).toMatch(/forbidden/);
    expect(error?.message).toMatch(/moderator/);
  });

  test('the owner can always create a market', async () => {
    const { error } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'Owner market',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
  });

  test('no market about a specific person, even for the owner', async () => {
    const { error: generalErr } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'About someone',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      p_subject_user_ids: [users.member.id],
    });
    expect(generalErr?.message).toMatch(/invalid_operation/);
    expect(generalErr?.message).toMatch(/can't be about a specific person/);

    const { error: optionErr } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'About someone via option',
      p_description: 'test',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      p_options: [`@member`, 'Someone else'],
    });
    expect(optionErr?.message).toMatch(/invalid_operation/);
    expect(optionErr?.message).toMatch(/can't be about a specific person/);
  });

  test('assign_group_moderator is scoped to public groups only', async () => {
    const privateGroup = await setupGroup(users.admin, [users.member]);
    const { error } = await users.admin.client.rpc('assign_group_moderator', {
      p_group_id: privateGroup.id,
      p_target_user_id: users.member.id,
      p_is_moderator: true,
    });
    expect(error?.message).toMatch(/not_found/);
  });

  test('a non-admin cannot assign a moderator', async () => {
    const { error } = await users.member.client.rpc('assign_group_moderator', {
      p_group_id: group.id,
      p_target_user_id: users.other.id,
      p_is_moderator: true,
    });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('an admin promotes a member to moderator, who can then create a market, and demoting removes it again', async () => {
    const { error: promoteErr } = await users.admin.client.rpc('assign_group_moderator', {
      p_group_id: group.id,
      p_target_user_id: users.member.id,
      p_is_moderator: true,
    });
    expect(promoteErr).toBeNull();

    const { data: candidates } = await users.admin.client.rpc('list_group_moderator_candidates', { p_group_id: group.id });
    const memberRow = (candidates ?? []).find((c: { user_id: string }) => c.user_id === users.member.id);
    expect(memberRow?.role).toBe('moderator');

    const { error: createErr } = await users.member.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'Mod-created market',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(createErr).toBeNull();

    const { error: demoteErr } = await users.admin.client.rpc('assign_group_moderator', {
      p_group_id: group.id,
      p_target_user_id: users.member.id,
      p_is_moderator: false,
    });
    expect(demoteErr).toBeNull();

    const { error: blockedAgainErr } = await users.member.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'Should fail again',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(blockedAgainErr?.message).toMatch(/forbidden/);
  });
});

describe('void_market_by_owner: mod gate for public groups', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgvoid', ['admin', 'mod', 'member']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
    await users.mod.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgvmod' });
    await users.member.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgvmember' });
    await users.admin.client.rpc('assign_group_moderator', {
      p_group_id: group.id,
      p_target_user_id: users.mod.id,
      p_is_moderator: true,
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  async function createVoidableMarket() {
    const { data, error } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: `Voidable ${Date.now()}`,
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
    return Array.isArray(data) ? data[0] : data;
  }

  test('a regular member cannot void a market', async () => {
    const market = await createVoidableMarket();
    const { error } = await users.member.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('a moderator (not the owner) can void a market', async () => {
    const market = await createVoidableMarket();
    const { error } = await users.mod.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error).toBeNull();

    const { data: voided } = await adminClient.from('markets').select('status, outcome').eq('id', market.id).single();
    expect(voided!.status).toBe('voided');
    expect(voided!.outcome).toBe('void');
  });

  test('a private group is unaffected: a non-owner member still cannot void, moderator role or not', async () => {
    const privateGroup = await setupGroup(users.admin, [users.mod]);
    const { data: marketData, error: createErr } = await users.admin.client.rpc('create_market', {
      p_group_id: privateGroup.id,
      p_title: 'Private voidable',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(createErr).toBeNull();
    const market = Array.isArray(marketData) ? marketData[0] : marketData;

    const { error } = await users.mod.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(error?.message).toMatch(/forbidden/);
  });
});

describe('propose_resolution: mod gate for public groups', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgres', ['admin', 'mod', 'member']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
    await users.mod.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgrmod' });
    await users.member.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgrmember' });
    await users.admin.client.rpc('assign_group_moderator', {
      p_group_id: group.id,
      p_target_user_id: users.mod.id,
      p_is_moderator: true,
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  async function createResolvableMarket() {
    const { data, error } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: `Resolvable ${Date.now()}`,
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
    return Array.isArray(data) ? data[0] : data;
  }

  test('a regular member cannot resolve a market', async () => {
    const market = await createResolvableMarket();
    const { error } = await users.member.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(error?.message).toMatch(/forbidden/);
    expect(error?.message).toMatch(/moderator/);

    // Confirm it's still genuinely open -- the rejected call didn't half-apply.
    const { data: stillOpen } = await adminClient.from('markets').select('status').eq('id', market.id).single();
    expect(stillOpen!.status).toBe('open');
  });

  test('the owner can resolve a market (not just a moderator)', async () => {
    const market = await createResolvableMarket();
    const { error } = await users.admin.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(error).toBeNull();

    const { data: resolved } = await adminClient.from('markets').select('status, outcome').eq('id', market.id).single();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.outcome).toBe('yes');
  });

  test('a moderator (not the owner) can resolve a market, and it instant-finalizes', async () => {
    const market = await createResolvableMarket();
    const { error } = await users.mod.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'no',
      p_justification: null,
      p_actual_value: null,
    });
    expect(error).toBeNull();

    const { data: resolved } = await adminClient.from('markets').select('status, outcome').eq('id', market.id).single();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.outcome).toBe('no');
  });

  test('a private group is unaffected: a regular member can still resolve a market', async () => {
    const privateGroup = await setupGroup(users.admin, [users.member]);
    const { data: marketData, error: createErr } = await users.admin.client.rpc('create_market', {
      p_group_id: privateGroup.id,
      p_title: 'Private resolvable',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(createErr).toBeNull();
    const market = Array.isArray(marketData) ? marketData[0] : marketData;
    // A private group defaults require_endorsement on, so the market needs a sponsor before it's
    // open for a resolution proposal -- unrelated to the mod gate this test is actually checking.
    const { error: sponsorErr } = await users.member.client.rpc('sponsor_market', { p_market_id: market.id });
    expect(sponsorErr).toBeNull();

    const { error } = await users.member.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(error).toBeNull();
  });
});

describe('_create_system_market / _resolve_system_market: the actor-less pipeline functions', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgsys', ['admin', 'winner', 'loser']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
    await users.winner.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'syswin' });
    await users.loser.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'syslose' });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('rejects a private group outright', async () => {
    const privateGroup = await setupGroup(users.admin, []);
    const { error } = await adminClient.rpc('_create_system_market', {
      p_group_id: privateGroup.id,
      p_title: 'Should fail',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('multiple_choice without options is rejected the same way create_market rejects it', async () => {
    const { error } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: 'Should fail',
      p_description: 'test',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('multiple_choice full cycle: create with two options, bet, resolve by option_id', async () => {
    // This is the shape sports-create-markets/sports-resolve-markets actually use: one option per
    // team instead of yes_no, since a "{home} vs. {away}" title (no longer phrased as a question)
    // has no yes_no explainer card to fall back on -- see ARCHITECTURE.md's Phase 2 section.
    const { data: marketData, error: createErr } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: 'Winners vs. Losers',
      p_description: 'test',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      p_options: ['Winners', 'Losers'],
    });
    expect(createErr).toBeNull();
    const market = Array.isArray(marketData) ? marketData[0] : marketData;
    expect(market.status).toBe('open');

    const { data: options } = await adminClient.from('market_options').select('id, label').eq('market_id', market.id);
    const winningOption = options!.find((o) => o.label === 'Winners')!;
    const losingOption = options!.find((o) => o.label === 'Losers')!;

    const { error: betWinErr } = await users.winner.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: null,
      p_amount: 100,
      p_option_id: winningOption.id,
    });
    expect(betWinErr).toBeNull();
    const { error: betLoseErr } = await users.loser.client.rpc('place_bet', {
      p_market_id: market.id,
      p_side: null,
      p_amount: 100,
      p_option_id: losingOption.id,
    });
    expect(betLoseErr).toBeNull();

    const { data: resolvedData, error: resolveErr } = await adminClient.rpc('_resolve_system_market', {
      p_market_id: market.id,
      p_option_id: winningOption.id,
    });
    expect(resolveErr).toBeNull();
    const resolved = Array.isArray(resolvedData) ? resolvedData[0] : resolvedData;
    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome_option_id).toBe(winningOption.id);

    const { data: winnerMembership } = await adminClient
      .from('memberships')
      .select('balance')
      .eq('group_id', group.id)
      .eq('user_id', users.winner.id)
      .single();
    // Seeded 1000, bet 100, wins this 200 pool outright.
    expect(winnerMembership!.balance).toBe(1100);
  });

  test('_resolve_system_market rejects passing both an option and an outcome', async () => {
    const { data: marketData } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: 'Option XOR outcome',
      p_description: 'test',
      p_market_type: 'multiple_choice',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      p_options: ['A', 'B'],
    });
    const market = Array.isArray(marketData) ? marketData[0] : marketData;
    const { data: options } = await adminClient.from('market_options').select('id').eq('market_id', market.id).limit(1);

    const { error } = await adminClient.rpc('_resolve_system_market', {
      p_market_id: market.id,
      p_outcome: 'void',
      p_option_id: options![0].id,
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('creates a market with no creator, already open, no auth.uid() in context', async () => {
    // adminClient is the service-role client -- no user session, no JWT, so auth.uid() is
    // genuinely NULL here, the same as a real cron-triggered Edge Function call. This is the
    // actual shape that bit end_season() before it was split into an actor-less core (see
    // ARCHITECTURE.md) -- a test that only ever calls through a real user session would miss it.
    const { data, error } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: 'Will the system win?',
      p_description: 'Auto-generated test market',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
    const market = Array.isArray(data) ? data[0] : data;
    expect(market.status).toBe('open');
    expect(market.creator_id).toBeNull();
  });

  test('full cycle: create, bet, resolve -- money conserves with a null creator_id throughout', async () => {
    const { data: marketData, error: createErr } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: 'Full cycle system market',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(createErr).toBeNull();
    const market = Array.isArray(marketData) ? marketData[0] : marketData;

    const { error: betWinErr } = await users.winner.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });
    expect(betWinErr).toBeNull();
    const { error: betLoseErr } = await users.loser.client.rpc('place_bet', { p_market_id: market.id, p_side: 'no', p_amount: 100 });
    expect(betLoseErr).toBeNull();

    const { data: resolvedData, error: resolveErr } = await adminClient.rpc('_resolve_system_market', {
      p_market_id: market.id,
      p_outcome: 'yes',
    });
    expect(resolveErr).toBeNull();
    const resolved = Array.isArray(resolvedData) ? resolvedData[0] : resolvedData;
    // Instant finalize, same as any public-group market -- never sits in 'proposed'.
    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome).toBe('yes');

    const { data: winnerMembership } = await adminClient
      .from('memberships')
      .select('balance')
      .eq('group_id', group.id)
      .eq('user_id', users.winner.id)
      .single();
    // Balance already at 1100 from the earlier multiple_choice full-cycle test in this describe
    // block (same winner, same group, no reset between tests) -- bet 100 (1000), wins this 200
    // pool outright (1200).
    expect(winnerMembership!.balance).toBe(1200);

    const { data: proposal } = await adminClient
      .from('resolution_proposals')
      .select('proposer_id')
      .eq('market_id', market.id)
      .single();
    expect(proposal!.proposer_id).toBeNull();
  });

  test('_resolve_system_market refuses a market in a private group', async () => {
    const privateGroup = await setupGroup(users.admin, [users.winner]);
    const privMarket = await createMarket(users.admin, privateGroup.id);
    const { error } = await adminClient.rpc('_resolve_system_market', {
      p_market_id: privMarket.id,
      p_outcome: 'yes',
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });
});

describe('awards_enabled = false: a public group never writes group_titles', () => {
  test('a resolved market with a real win writes no risk_taker row for a public group, but does for an otherwise-identical private group', async () => {
    const users = await createTestUsers('pgawd', ['admin', 'winner', 'loser']);
    try {
      await makeAdmin(users.admin);

      // Public: owner creates+sponsors around the endorsement gate isn't needed here since the
      // owner can both create and (as a mod-equivalent) the flow only needs a second member to
      // sponsor and bet against — require_endorsement defaults on for a freshly created group.
      const pub = await createPublicGroup(users.admin);
      await users.winner.client.rpc('join_public_group', { p_group_id: pub.id, p_nickname: 'winner' });
      await users.loser.client.rpc('join_public_group', { p_group_id: pub.id, p_nickname: 'loser' });

      const { data: pubMarketData, error: pubCreateErr } = await users.admin.client.rpc('create_market', {
        p_group_id: pub.id,
        p_title: 'Public resolution test',
        p_description: 'test',
        p_market_type: 'yes_no',
        p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      });
      expect(pubCreateErr).toBeNull();
      const pubMarket = Array.isArray(pubMarketData) ? pubMarketData[0] : pubMarketData;

      await users.winner.client.rpc('sponsor_market', { p_market_id: pubMarket.id });
      await fastForwardCloseTime(pubMarket.id, 60_000);
      await users.winner.client.rpc('place_bet', { p_market_id: pubMarket.id, p_side: 'yes', p_amount: 100 });
      await users.loser.client.rpc('place_bet', { p_market_id: pubMarket.id, p_side: 'no', p_amount: 100 });
      // No backdate/finalize_market call here: propose_resolution() finalizes a public group's
      // market in the same transaction (see 20260825110000), so it's already resolved the moment
      // this returns — a separate finalize_market() call would find nothing left to finalize.
      // Proposed by the owner (users.admin), not winner -- propose_resolution() is mod-or-owner
      // gated for a public group (20260827100000) and winner is a plain member here.
      const { error: proposeErr } = await users.admin.client.rpc('propose_resolution', {
        p_market_id: pubMarket.id,
        p_outcome: 'yes',
        p_justification: null,
        p_actual_value: null,
      });
      expect(proposeErr).toBeNull();

      const { data: resolvedMarket } = await adminClient.from('markets').select('status').eq('id', pubMarket.id).single();
      expect(resolvedMarket!.status).toBe('resolved');

      const { data: pubTitleRow } = await adminClient
        .from('group_titles')
        .select('user_id')
        .eq('group_id', pub.id)
        .eq('title_key', 'risk_taker')
        .maybeSingle();
      expect(pubTitleRow).toBeNull();

      // Control: an otherwise-identical private group runs the exact same flow and does get a
      // risk_taker row, confirming the gate is specific to awards_enabled and not a general break.
      const priv = await setupGroup(users.admin, [users.winner, users.loser]);
      const { data: privMarketData, error: privCreateErr } = await users.winner.client.rpc('create_market', {
        p_group_id: priv.id,
        p_title: 'Private resolution test',
        p_description: 'test',
        p_market_type: 'yes_no',
        p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      });
      expect(privCreateErr).toBeNull();
      const privMarket = Array.isArray(privMarketData) ? privMarketData[0] : privMarketData;

      await users.loser.client.rpc('sponsor_market', { p_market_id: privMarket.id });
      await fastForwardCloseTime(privMarket.id, 60_000);
      await users.winner.client.rpc('place_bet', { p_market_id: privMarket.id, p_side: 'yes', p_amount: 100 });
      await users.loser.client.rpc('place_bet', { p_market_id: privMarket.id, p_side: 'no', p_amount: 100 });
      const { error: privProposeErr } = await users.loser.client.rpc('propose_resolution', {
        p_market_id: privMarket.id,
        p_outcome: 'yes',
        p_justification: null,
        p_actual_value: null,
      });
      expect(privProposeErr).toBeNull();
      await backdate('resolution_proposals', 'market_id', privMarket.id, 'proposed_at', 9);
      const { error: privFinalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: privMarket.id });
      expect(privFinalizeErr).toBeNull();

      const { data: privTitleRow } = await adminClient
        .from('group_titles')
        .select('user_id')
        .eq('group_id', priv.id)
        .eq('title_key', 'risk_taker')
        .maybeSingle();
      expect(privTitleRow?.user_id).toBe(users.winner.id);
    } finally {
      await cleanupTestUsers(users);
    }
  });
});

describe('pipeline_settings: the auto-generated-market kill switch', () => {
  let users: Record<string, TestUser>;

  beforeAll(async () => {
    users = await createTestUsers('pgpipe', ['admin', 'notadmin']);
    await makeAdmin(users.admin);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a non-admin cannot read or change pipeline settings', async () => {
    const { error: listErr } = await users.notadmin.client.rpc('list_pipeline_settings');
    expect(listErr?.message).toMatch(/forbidden/);

    const { error: setErr } = await users.notadmin.client.rpc('set_pipeline_enabled', { p_pipeline: 'sports', p_enabled: true });
    expect(setErr?.message).toMatch(/forbidden/);
  });

  test('the sports pipeline exists and starts disabled', async () => {
    const { data, error } = await users.admin.client.rpc('list_pipeline_settings');
    expect(error).toBeNull();
    const byPipeline = new Map((data ?? []).map((r: { pipeline: string; enabled: boolean }) => [r.pipeline, r.enabled]));
    expect(byPipeline.get('sports')).toBe(false);
  });

  test('an admin can flip a pipeline on and back off', async () => {
    const { error: onErr } = await users.admin.client.rpc('set_pipeline_enabled', { p_pipeline: 'sports', p_enabled: true });
    expect(onErr).toBeNull();

    const { data: afterOn } = await adminClient.from('pipeline_settings').select('enabled').eq('pipeline', 'sports').single();
    expect(afterOn!.enabled).toBe(true);

    const { error: offErr } = await users.admin.client.rpc('set_pipeline_enabled', { p_pipeline: 'sports', p_enabled: false });
    expect(offErr).toBeNull();

    const { data: afterOff } = await adminClient.from('pipeline_settings').select('enabled').eq('pipeline', 'sports').single();
    expect(afterOff!.enabled).toBe(false);
  });

  test('an unknown pipeline name is rejected', async () => {
    const { error } = await users.admin.client.rpc('set_pipeline_enabled', { p_pipeline: 'crypto', p_enabled: true });
    expect(error?.message).toMatch(/not_found/);
  });
});

describe('NFL/CFB hand-created markets: mods and the owner can, ordinary members cannot', () => {
  let users: Record<string, TestUser>;
  let nflGroup: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgpipeblock', ['admin', 'mod', 'member']);
    await makeAdmin(users.admin);
    // A test group named exactly 'NFL' exercises the ordinary mod-or-owner gate the same way the
    // real seeded group would, without touching it — there's no unique constraint on groups.name,
    // so this can't collide with the real one. There's no name-based carve-out to test here
    // (20260830180000 removed the one that used to exist): NFL/CFB use the exact same
    // create_market() gate as any other public group, this just picks a realistic name.
    nflGroup = await createPublicGroup(users.admin, 'generic', 'NFL');
    await users.mod.client.rpc('join_public_group', { p_group_id: nflGroup.id, p_nickname: 'pgpipemod' });
    await users.member.client.rpc('join_public_group', { p_group_id: nflGroup.id, p_nickname: 'pgpipemember' });
    await users.admin.client.rpc('assign_group_moderator', {
      p_group_id: nflGroup.id,
      p_target_user_id: users.mod.id,
      p_is_moderator: true,
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('the owner can hand-create a market, in addition to whatever the pipeline creates', async () => {
    const { error } = await users.admin.client.rpc('create_market', {
      p_group_id: nflGroup.id,
      p_title: 'Should succeed (owner)',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
  });

  test('an assigned moderator can hand-create a market too', async () => {
    const { error } = await users.mod.client.rpc('create_market', {
      p_group_id: nflGroup.id,
      p_title: 'Should succeed (mod)',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
  });

  test('an ordinary member still cannot hand-create a market', async () => {
    const { error } = await users.member.client.rpc('create_market', {
      p_group_id: nflGroup.id,
      p_title: 'Should fail',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('an otherwise-identical public group not named NFL/CFB behaves the same way', async () => {
    const ordinaryGroup = await createPublicGroup(users.admin);
    const { error } = await users.admin.client.rpc('create_market', {
      p_group_id: ordinaryGroup.id,
      p_title: 'Should succeed',
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
  });
});

describe('public group notifications: bettor-only fan-out for closed/resolved markets', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgbet', ['admin', 'bettor', 'other']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
    await users.bettor.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgbetbettor' });
    await users.other.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgbetother' });
    for (const u of [users.admin, users.bettor, users.other]) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('market_opened still reaches everyone (nobody could have bet yet)', async () => {
    const { data, error } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: `Opened fanout ${Date.now()}`,
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
    const market = Array.isArray(data) ? data[0] : data;

    const event = await latestEvent('market_opened', group.id);
    expect(event.market_id).toBe(market.id);
    const recipients = await recipientIds(event.id);
    // admin is the actor (excluded); bettor and other both still hear about a market they
    // haven't had a chance to bet on yet.
    expect(recipients.sort()).toEqual([users.bettor.id, users.other.id].sort());
  });

  test('market_closed and market_resolved only reach whoever actually bet', async () => {
    const { data, error } = await users.admin.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: `Closed/resolved fanout ${Date.now()}`,
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 2000).toISOString(),
    });
    expect(error).toBeNull();
    const market = Array.isArray(data) ? data[0] : data;

    // Only bettor ever bets on this one — admin (the creator) and other never do.
    const { error: betErr } = await users.bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });
    expect(betErr).toBeNull();

    await fastForwardCloseTime(market.id, 2000);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await adminClient.rpc('expire_stale');

    const closedEvent = await latestEvent('market_closed', group.id);
    expect(closedEvent.market_id).toBe(market.id);
    const closedRecipients = await recipientIds(closedEvent.id);
    expect(closedRecipients).toEqual([users.bettor.id]);

    const { error: proposeErr } = await users.admin.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });
    expect(proposeErr).toBeNull();

    const resolvedEvent = await latestEvent('market_resolved', group.id);
    expect(resolvedEvent.market_id).toBe(market.id);
    const resolvedRecipients = await recipientIds(resolvedEvent.id);
    // admin proposed it (excluded as actor, and never bet either way); other never bet.
    expect(resolvedRecipients).toEqual([users.bettor.id]);
  });

  test('a private group is unaffected: closed/resolved still reach non-bettors too', async () => {
    const privateGroup = await setupGroup(users.admin, [users.bettor, users.other]);
    for (const u of [users.bettor, users.other]) await subscribe(u);
    const market = await createMarket(users.admin, privateGroup.id, { closesInMs: 2000 });
    await users.bettor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });
    await fastForwardCloseTime(market.id, 2000);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await adminClient.rpc('expire_stale');

    const closedEvent = await latestEvent('market_closed', privateGroup.id);
    const closedRecipients = await recipientIds(closedEvent.id);
    // other never bet, but this is a private group -- unaffected by the public-group-only filter.
    expect(closedRecipients).toContain(users.other.id);
  });
});

describe('system_markets_opened: one push per pipeline run, not one per market', () => {
  let users: Record<string, TestUser>;
  let group: PublicGroupRow;

  beforeAll(async () => {
    users = await createTestUsers('pgsysntf', ['admin']);
    await makeAdmin(users.admin);
    group = await createPublicGroup(users.admin);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  async function eventCount(eventType: string) {
    const { count, error } = await adminClient
      .from('notification_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', eventType)
      .eq('group_id', group.id);
    if (error) throw error;
    return count ?? 0;
  }

  test('_create_system_market no longer emits market_opened itself', async () => {
    const before = await eventCount('market_opened');
    const { error } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: `No auto-emit ${Date.now()}`,
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
    const after = await eventCount('market_opened');
    expect(after).toBe(before);
  });

  test('a single-market run gets the normal named market_opened push', async () => {
    const { data, error } = await adminClient.rpc('_create_system_market', {
      p_group_id: group.id,
      p_title: `Single run ${Date.now()}`,
      p_description: 'test',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(error).toBeNull();
    const market = Array.isArray(data) ? data[0] : data;

    const { error: notifyErr } = await adminClient.rpc('_notify_system_markets_created', {
      p_group_id: group.id,
      p_market_ids: [market.id],
    });
    expect(notifyErr).toBeNull();

    const event = await latestEvent('market_opened', group.id);
    expect(event.market_id).toBe(market.id);
  });

  test('a multi-market run gets one consolidated system_markets_opened push instead', async () => {
    const before = await eventCount('market_opened');

    const marketIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data, error } = await adminClient.rpc('_create_system_market', {
        p_group_id: group.id,
        p_title: `Multi run ${Date.now()}-${i}`,
        p_description: 'test',
        p_market_type: 'yes_no',
        p_closes_at: new Date(Date.now() + 600_000).toISOString(),
      });
      expect(error).toBeNull();
      const market = Array.isArray(data) ? data[0] : data;
      marketIds.push(market.id);
    }

    const { error: notifyErr } = await adminClient.rpc('_notify_system_markets_created', {
      p_group_id: group.id,
      p_market_ids: marketIds,
    });
    expect(notifyErr).toBeNull();

    // Exactly one consolidated event, and no new market_opened events from this run.
    const consolidatedEvent = await latestEvent('system_markets_opened', group.id);
    expect(consolidatedEvent.market_id).toBeNull();
    const after = await eventCount('market_opened');
    expect(after).toBe(before);
  });

  test('an empty run is a no-op', async () => {
    const beforeOpened = await eventCount('market_opened');
    const beforeConsolidated = await eventCount('system_markets_opened');

    const { error } = await adminClient.rpc('_notify_system_markets_created', { p_group_id: group.id, p_market_ids: [] });
    expect(error).toBeNull();

    expect(await eventCount('market_opened')).toBe(beforeOpened);
    expect(await eventCount('system_markets_opened')).toBe(beforeConsolidated);
  });
});
