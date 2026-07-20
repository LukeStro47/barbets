import { afterAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, type GroupRow } from './helpers/scenarios';

describe('custom season end dates', () => {
  let users: Record<string, TestUser>;

  afterAll(async () => {
    if (users) await cleanupTestUsers(users);
  });

  test('create_group rejects a custom season length with no end date, or one in the past', async () => {
    users = await createTestUsers('csc', ['owner']);

    const { error: missing } = await users.owner.client.rpc('create_group', {
      p_name: 'missing custom date',
      p_seed_amount: 1000,
      p_seasons_enabled: true,
      p_season_length: 'custom',
      p_nickname: 'owner',
      p_timezone: 'UTC',
      p_season_custom_ends_at: null,
    });
    expect(missing?.message).toMatch(/pick a custom season end date/);

    const { error: past } = await users.owner.client.rpc('create_group', {
      p_name: 'past custom date',
      p_seed_amount: 1000,
      p_seasons_enabled: true,
      p_season_length: 'custom',
      p_nickname: 'owner',
      p_timezone: 'UTC',
      p_season_custom_ends_at: new Date(Date.now() - 60000).toISOString(),
    });
    expect(past?.message).toMatch(/pick a custom season end date/);
  });

  test('update_group_settings applies the same validation', async () => {
    const group = await setupGroup(users.owner, [], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });

    const { error } = await users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: true,
      p_season_length: 'custom',
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
      p_season_custom_ends_at: null,
    });
    expect(error?.message).toMatch(/pick a custom season end date/);
  });

  test('start_season freezes ends_at from the custom date, and rejects starting once that date has passed', async () => {
    const group = await setupGroup(users.owner, [], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
    await users.owner.client.rpc('end_season', { p_group_id: group.id });

    // Set a real future custom end date (passes validation), then backdate
    // it directly via the admin client rather than sleeping through real
    // time — start_season must catch a stale date rather than freezing a
    // bogus already-past ends_at.
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const { error: settingsErr } = await users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: true,
      p_season_length: 'custom',
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
      p_season_custom_ends_at: soon,
    });
    expect(settingsErr).toBeNull();

    await backdate('group_settings', 'group_id', group.id, 'season_custom_ends_at', 1);

    const { error: staleErr } = await users.owner.client.rpc('start_season', { p_group_id: group.id });
    expect(staleErr?.message).toMatch(/already passed/);

    // Fix it with a real future date and confirm the freeze actually works.
    const realEnd = new Date(Date.now() + 3600_000).toISOString();
    await users.owner.client.rpc('update_group_settings', {
      p_group_id: group.id,
      p_seed_amount: 1000,
      p_seasons_enabled: true,
      p_season_length: 'custom',
      p_timezone: 'UTC',
      p_betting_enabled: true,
      p_accepting_members: true,
      p_season_custom_ends_at: realEnd,
    });

    const { error: startErr } = await users.owner.client.rpc('start_season', { p_group_id: group.id });
    expect(startErr).toBeNull();

    const { data: season } = await adminClient.from('seasons').select('ends_at, season_length').eq('group_id', group.id).eq('status', 'active').single();
    expect(season!.season_length).toBe('custom');
    expect(new Date(season!.ends_at!).getTime()).toBe(new Date(realEnd).getTime());
  });
});

describe('season naming', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;
  let seasonId: string;

  afterAll(async () => {
    if (users) await cleanupTestUsers(users);
  });

  test('the owner can name and rename a season; a non-owner cannot', async () => {
    users = await createTestUsers('snm', ['owner', 'other']);
    group = await setupGroup(users.owner, [users.other], { seedAmount: 1000, seasonsEnabled: true, seasonLength: 'manual' });
    const { data: season } = await adminClient.from('seasons').select('id').eq('group_id', group.id).eq('status', 'active').single();
    seasonId = season!.id;

    const { error: nonOwnerErr } = await users.other.client.rpc('rename_season', { p_season_id: seasonId, p_name: 'Sneaky Rename' });
    expect(nonOwnerErr?.message).toMatch(/forbidden/);

    const { error } = await users.owner.client.rpc('rename_season', { p_season_id: seasonId, p_name: 'Friday Game Night' });
    expect(error).toBeNull();

    const { data: named } = await adminClient.from('seasons').select('name').eq('id', seasonId).single();
    expect(named!.name).toBe('Friday Game Night');
  });

  test('a blank name clears back to the null fallback', async () => {
    const { error } = await users.owner.client.rpc('rename_season', { p_season_id: seasonId, p_name: '   ' });
    expect(error).toBeNull();

    const { data: cleared } = await adminClient.from('seasons').select('name').eq('id', seasonId).single();
    expect(cleared!.name).toBeNull();
  });
});
