import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

describe('per-season betting gate', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let seasonId: string;

  beforeAll(async () => {
    users = await createTestUsers('sbg', ['owner', 'other']);
    group = await setupGroup(users.owner, [users.other], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'manual',
      openSeasonBetting: false, // exercise the paused state on purpose
    });
    const { data: season } = await adminClient.from('seasons').select('id').eq('group_id', group.id).eq('status', 'active').single();
    seasonId = season!.id;
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a fresh season starts with betting paused, rejecting market creation', async () => {
    const { data: season } = await adminClient.from('seasons').select('betting_open').eq('id', seasonId).single();
    expect(season!.betting_open).toBe(false);

    const { error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'should be blocked',
      p_description: 'x',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
    });
    expect(error?.message).toMatch(/hasn't opened betting/);
  });

  test('group-level betting_enabled has no bearing on a seasons-enabled group', async () => {
    // setupGroup already flipped group_settings.betting_enabled on via
    // update_group_settings — confirm it's true, yet market creation is
    // still correctly blocked (asserted above), proving the season's own
    // betting_open is the real gate here, not the group-level flag.
    const { data: settings } = await adminClient.from('group_settings').select('betting_enabled').eq('group_id', group.id).single();
    expect(settings!.betting_enabled).toBe(true);
  });

  test('only the owner can open betting for the season', async () => {
    const { error } = await users.other.client.rpc('open_season_betting', { p_season_id: seasonId });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('once the owner opens betting, market creation succeeds', async () => {
    const { error: openErr } = await users.owner.client.rpc('open_season_betting', { p_season_id: seasonId });
    expect(openErr).toBeNull();

    const { data: season } = await adminClient.from('seasons').select('betting_open').eq('id', seasonId).single();
    expect(season!.betting_open).toBe(true);

    const { error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'now allowed',
      p_description: 'x',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [],
    });
    expect(error).toBeNull();

    // opening it twice is a clean rejection, not a silent no-op
    const { error: reopenErr } = await users.owner.client.rpc('open_season_betting', { p_season_id: seasonId });
    expect(reopenErr?.message).toMatch(/already open/);
  });
});

describe("a market's closes_at can't outlive its season", () => {
  let users: Record<string, TestUser>;

  afterAll(async () => {
    if (users) await cleanupTestUsers(users);
  });

  test('rejected past a custom season end date, allowed for a manual-length season', async () => {
    users = await createTestUsers('sce', ['owner']);
    const customEndsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h out
    const group = await setupGroup(users.owner, [], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'custom',
      seasonCustomEndsAt: customEndsAt,
    });

    const { error: tooLate } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'closes after the season ends',
      p_description: 'x',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4h out, past the 2h season end
      p_line: null,
      p_subject_user_ids: [],
    });
    expect(tooLate?.message).toMatch(/can't be later than the season/);

    const { error: fine } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'closes before the season ends',
      p_description: 'x',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h out, inside the window
      p_line: null,
      p_subject_user_ids: [],
    });
    expect(fine).toBeNull();
  });

  test('a manual-length season has no closes_at ceiling', async () => {
    const users2 = await createTestUsers('sma', ['owner']);
    try {
      const group = await setupGroup(users2.owner, [], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });

      const farOut = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString(); // ~200 days out
      const { error } = await users2.owner.client.rpc('create_market', {
        p_group_id: group.id,
        p_title: 'far out close, manual season',
        p_description: 'x',
        p_market_type: 'yes_no',
        p_closes_at: farOut,
        p_line: null,
        p_subject_user_ids: [],
      });
      expect(error).toBeNull();
    } finally {
      await cleanupTestUsers(users2);
    }
  });
});
