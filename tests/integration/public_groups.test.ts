import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, fastForwardCloseTime, type GroupRow } from './helpers/scenarios';

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

async function createPublicGroup(admin: TestUser, category: 'generic' | 'campus' = 'generic') {
  const { data, error } = await admin.client.rpc('create_public_group', {
    p_name: `Public Test Group ${Date.now()}`,
    p_category: category,
    p_seed_amount: 1000,
    p_nickname: admin.tag,
    p_timezone: 'UTC',
  });
  if (error || !data) throw new Error(`createPublicGroup: ${error?.message}`);
  return (Array.isArray(data) ? data[0] : data) as PublicGroupRow;
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
    expect(membership!.role).toBe('member'); // owner authority comes from groups.owner_id, not this column
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

  test('accepting_members off blocks a genuinely new join the same way it does for a private group', async () => {
    await users.admin.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: false,
      p_season_length: null,
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: false,
    });
    try {
      const { error } = await users.b.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: 'pgb' });
      expect(error?.message).toMatch(/invalid_operation/);
      expect(error?.message).toMatch(/accepting new members/);
    } finally {
      await users.admin.client.rpc('update_group_settings', {
        p_group_id: group.id,
        p_seed_amount: 1000,
        p_seasons_enabled: false,
        p_season_length: null,
        p_timezone: 'UTC',
        p_betting_enabled: true,
        p_accepting_members: true,
      });
    }
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
      const { error: proposeErr } = await users.winner.client.rpc('propose_resolution', {
        p_market_id: pubMarket.id,
        p_outcome: 'yes',
        p_justification: null,
        p_actual_value: null,
      });
      expect(proposeErr).toBeNull();
      await backdate('resolution_proposals', 'market_id', pubMarket.id, 'proposed_at', 9);
      const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: pubMarket.id });
      expect(finalizeErr).toBeNull();

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
