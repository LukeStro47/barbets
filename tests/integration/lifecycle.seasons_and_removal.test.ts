import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, type GroupRow } from './helpers/scenarios';

async function membershipRow(groupId: string, userId: string) {
  const { data, error } = await adminClient
    .from('memberships')
    .select('id, balance, status')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data!;
}

describe('season lifecycle', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('szn', ['owner', 'sponsor', 'a', 'b', 'c']);
    group = await setupGroup(users.owner, [users.sponsor, users.a, users.b, users.c], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'manual',
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('end_season voids open markets, refunds stakes, and snapshots results', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    const before = await membershipRow(group.id, users.a.id);
    await users.a.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 100 });

    const { error: endErr } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
    expect(endErr).toBeNull();

    const { data: marketAfter } = await adminClient.from('markets').select('status, outcome').eq('id', market.id).single();
    expect(marketAfter!.status).toBe('voided');
    expect(marketAfter!.outcome).toBe('void');

    const after = await membershipRow(group.id, users.a.id);
    expect(after.balance).toBe(before.balance); // refunded back to pre-bet balance

    const { data: results } = await adminClient.from('season_results').select('snapshot').eq('group_id', group.id).single();
    expect(results!.snapshot.champion).toBeTruthy();
    expect(Array.isArray(results!.snapshot.final_balances)).toBe(true);
  });

  test('start_season reseeds currently-active members by default; only members who opt out go dormant', async () => {
    const { data: intermission } = await adminClient
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'intermission')
      .single();
    expect(intermission).toBeTruthy();

    // a and b are still 'active' from setup and do nothing — active members
    // are included by default now, no explicit opt-in needed.
    await users.c.client.rpc('opt_out_season', { p_season_id: intermission!.id });

    const { error: startErr } = await users.owner.client.rpc('start_season', { p_group_id: group.id });
    expect(startErr).toBeNull();

    const a = await membershipRow(group.id, users.a.id);
    const b = await membershipRow(group.id, users.b.id);
    const c = await membershipRow(group.id, users.c.id);

    expect(a.status).toBe('active');
    expect(a.balance).toBe(1000);
    expect(b.status).toBe('active');
    expect(b.balance).toBe(1000);
    expect(c.status).toBe('dormant');

    // Every season starts with betting paused, even a season the owner just
    // continued into — later tests in this block need to create markets.
    const { data: activeSeason } = await adminClient
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .single();
    const { error: openErr } = await users.owner.client.rpc('open_season_betting', { p_season_id: activeSeason!.id });
    expect(openErr).toBeNull();
  });

  test('a dormant member cannot bet, and cannot be a market subject', async () => {
    const market = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    const { error: betErr } = await users.c.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 10 });
    expect(betErr?.message).toMatch(/invalid_operation/);

    const { error: subjectErr } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'about a dormant member',
      p_description: 'should fail',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [users.c.id],
    });
    expect(subjectErr?.message).toMatch(/invalid_operation/);
  });

  test('late opt-in reseeds and activates a dormant member immediately', async () => {
    const { data: activeSeason } = await adminClient
      .from('seasons')
      .select('id')
      .eq('group_id', group.id)
      .eq('status', 'active')
      .single();

    const { error } = await users.c.client.rpc('opt_in_season', { p_season_id: activeSeason!.id });
    expect(error).toBeNull();

    const c = await membershipRow(group.id, users.c.id);
    expect(c.status).toBe('active');
    expect(c.balance).toBe(1000);
  });
});

describe('member removal', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('rmv', ['owner', 'sponsor', 'target', 'other']);
    group = await setupGroup(users.owner, [users.sponsor, users.target, users.other], { seedAmount: 1000 });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('removing a member voids markets they are a subject of, and refunds their own open bets elsewhere', async () => {
    const marketAboutTarget = await createMarket(users.owner, group.id, {
      subjectIds: [users.target.id],
      closesInMs: 60000,
    });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: marketAboutTarget.id });
    const otherBefore = await membershipRow(group.id, users.other.id);
    await users.other.client.rpc('place_bet', { p_market_id: marketAboutTarget.id, p_side: 'yes', p_amount: 80 });

    const marketTargetBetIn = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: marketTargetBetIn.id });
    const targetBefore = await membershipRow(group.id, users.target.id);
    await users.target.client.rpc('place_bet', { p_market_id: marketTargetBetIn.id, p_side: 'yes', p_amount: 60 });
    await users.other.client.rpc('place_bet', { p_market_id: marketTargetBetIn.id, p_side: 'no', p_amount: 40 });

    const { error: removeErr } = await users.owner.client.rpc('remove_member', {
      p_group_id: group.id,
      p_target_user_id: users.target.id,
    });
    expect(removeErr).toBeNull();

    // market about the removed subject: voided, other's bet refunded
    const { data: subjMarket } = await adminClient.from('markets').select('status').eq('id', marketAboutTarget.id).single();
    expect(subjMarket!.status).toBe('voided');
    const otherAfterSubjVoid = await membershipRow(group.id, users.other.id);

    // the market target merely bet in (not a subject): stays open, only target's bet refunded
    const { data: betMarket } = await adminClient.from('markets').select('status').eq('id', marketTargetBetIn.id).single();
    expect(betMarket!.status).toBe('open');

    const { data: otherBetStillOpen } = await adminClient
      .from('bets')
      .select('settled_at')
      .eq('market_id', marketTargetBetIn.id)
      .eq('user_id', users.other.id)
      .single();
    expect(otherBetStillOpen!.settled_at).toBeNull();

    const { data: targetBetRefunded } = await adminClient
      .from('bets')
      .select('settled_at, payout, amount')
      .eq('market_id', marketTargetBetIn.id)
      .eq('user_id', users.target.id)
      .single();
    expect(targetBetRefunded!.settled_at).not.toBeNull();
    expect(targetBetRefunded!.payout).toBe(targetBetRefunded!.amount);

    // balances: other got their subj-market stake back; target got their bet-market stake back
    expect(otherAfterSubjVoid.balance).toBe(otherBefore.balance - 40); // still has the live bet in marketTargetBetIn
    const targetAfter = await membershipRow(group.id, users.target.id);
    expect(targetAfter.balance).toBe(targetBefore.balance);
    expect(targetAfter.status).toBe('removed');
  });

  test('a removed member loses all access to the group', async () => {
    const { data } = await users.target.client.from('groups').select('id').eq('id', group.id);
    expect(data).toEqual([]);

    // removal rotates the invite code, so the removed member's own known
    // code is already dead (covered by the next test) — to actually reach
    // the "you can't rejoin" check, use the current (rotated) code.
    const { data: groupRow } = await adminClient.from('groups').select('invite_code').eq('id', group.id).single();
    const { error } = await users.target.client.rpc('join_group', { p_invite_code: groupRow!.invite_code });
    expect(error?.message).toMatch(/forbidden/);
  });

  test('removing a member rotates the invite code, so the old code no longer works for anyone', async () => {
    const { data: groupRow } = await adminClient.from('groups').select('invite_code').eq('id', group.id).single();
    expect(groupRow!.invite_code).not.toBe(group.invite_code);

    const newcomer = await createTestUsers('rmv2', ['newcomer']);
    try {
      const { error } = await newcomer.newcomer.client.rpc('join_group', { p_invite_code: group.invite_code });
      expect(error?.message).toMatch(/not_found/);
    } finally {
      await cleanupTestUsers(newcomer);
    }
  });
});

describe('leave group (self-service)', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('lv', ['owner', 'sponsor', 'leaver', 'other']);
    group = await setupGroup(users.owner, [users.sponsor, users.leaver, users.other], {
      seedAmount: 1000,
      seasonsEnabled: true,
      seasonLength: 'manual',
    });
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('the owner cannot leave their own group', async () => {
    const { error } = await users.owner.client.rpc('leave_group', { p_group_id: group.id });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('leaving voids markets you are a subject of, but your own open bets elsewhere stay in play and you go dormant (not removed)', async () => {
    const marketAboutLeaver = await createMarket(users.owner, group.id, { subjectIds: [users.leaver.id], closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: marketAboutLeaver.id });
    const otherBefore = await membershipRow(group.id, users.other.id);
    await users.other.client.rpc('place_bet', { p_market_id: marketAboutLeaver.id, p_side: 'yes', p_amount: 70 });

    const marketLeaverBetIn = await createMarket(users.owner, group.id, { closesInMs: 60000 });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: marketLeaverBetIn.id });
    const leaverBefore = await membershipRow(group.id, users.leaver.id);
    await users.leaver.client.rpc('place_bet', { p_market_id: marketLeaverBetIn.id, p_side: 'yes', p_amount: 40 });

    const { error: leaveErr } = await users.leaver.client.rpc('leave_group', { p_group_id: group.id });
    expect(leaveErr).toBeNull();

    const { data: subjMarket } = await adminClient.from('markets').select('status').eq('id', marketAboutLeaver.id).single();
    expect(subjMarket!.status).toBe('voided');
    const otherAfter = await membershipRow(group.id, users.other.id);
    expect(otherAfter.balance).toBe(otherBefore.balance); // subject market voided -> refunded

    const { data: betMarket } = await adminClient.from('markets').select('status').eq('id', marketLeaverBetIn.id).single();
    expect(betMarket!.status).toBe('open'); // stays open for everyone else

    // the leaver's own stake in marketLeaverBetIn is NOT refunded — it's still a live, unsettled bet
    const { data: leaverBetStillOpen } = await adminClient
      .from('bets')
      .select('settled_at')
      .eq('market_id', marketLeaverBetIn.id)
      .eq('user_id', users.leaver.id)
      .single();
    expect(leaverBetStillOpen!.settled_at).toBeNull();

    const leaverAfter = await membershipRow(group.id, users.leaver.id);
    expect(leaverAfter.balance).toBe(leaverBefore.balance - 40); // stake left the balance, not refunded
    expect(leaverAfter.status).toBe('dormant');

    // dormant (not removed) — the group is still visible, so a later rejoin is possible
    const { data: accessCheck } = await users.leaver.client.from('groups').select('id').eq('id', group.id);
    expect(accessCheck).toEqual([{ id: group.id }]);
  });

  test('leaving cancels a pending season opt-in, so a later start_season does not reactivate them', async () => {
    const stayer = await createTestUsers('lv2', ['stayer']);
    try {
      await stayer.stayer.client.rpc('join_group', { p_invite_code: group.invite_code, p_nickname: 'stayer' });

      const { error: endErr } = await users.owner.client.rpc('end_season', { p_group_id: group.id });
      expect(endErr).toBeNull();

      const { data: intermission } = await adminClient
        .from('seasons')
        .select('id')
        .eq('group_id', group.id)
        .eq('status', 'intermission')
        .single();

      await stayer.stayer.client.rpc('opt_in_season', { p_season_id: intermission!.id });
      await users.other.client.rpc('opt_in_season', { p_season_id: intermission!.id });

      // other opts in, then leaves before the season actually starts
      const { error: leaveErr } = await users.other.client.rpc('leave_group', { p_group_id: group.id });
      expect(leaveErr).toBeNull();

      const { data: staleOptin } = await adminClient
        .from('season_optins')
        .select('user_id')
        .eq('season_id', intermission!.id)
        .eq('user_id', users.other.id);
      expect(staleOptin).toEqual([]);

      const { error: startErr } = await users.owner.client.rpc('start_season', { p_group_id: group.id });
      expect(startErr).toBeNull();

      const otherAfterStart = await membershipRow(group.id, users.other.id);
      expect(otherAfterStart.status).toBe('dormant'); // must NOT have been reactivated into the new season
    } finally {
      await cleanupTestUsers(stayer);
    }
  });
});
