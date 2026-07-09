import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, sleep, type GroupRow } from './helpers/scenarios';

describe('market visibility (the core privacy invariant)', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    // 5 members: owner (creator), sponsor, two subjects, one plain bettor.
    users = await createTestUsers('viz', ['owner', 'sponsor', 'subjB', 'subjC', 'bettor']);
    group = await setupGroup(users.owner, [users.sponsor, users.subjB, users.subjC, users.bettor]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a market with two subjects is invisible to both subjects while open', async () => {
    const market = await createMarket(users.owner, group.id, { subjectIds: [users.subjB.id, users.subjC.id] });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });

    for (const subject of [users.subjB, users.subjC]) {
      const { data } = await subject.client.from('visible_markets').select('id').eq('id', market.id);
      expect(data, `${subject.tag} should not see the market`).toEqual([]);

      const { error: countErr } = await subject.client.rpc('get_open_bet_count', { p_market_id: market.id });
      expect(countErr?.message).toMatch(/^not_found/);

      const { error: betErr } = await subject.client.rpc('place_bet', {
        p_market_id: market.id,
        p_side: 'yes',
        p_amount: 10,
      });
      expect(betErr?.message).toMatch(/^not_found/);

      const { error: sponsorErr } = await subject.client.rpc('sponsor_market', { p_market_id: market.id });
      expect(sponsorErr?.message).toMatch(/^not_found/);
    }

    // non-subject members see it fine
    const { data: bettorView } = await users.bettor.client.from('visible_markets').select('id').eq('id', market.id);
    expect(bettorView).toHaveLength(1);
  });

  test('subjects stay blind through closed/proposed/disputed, then get full reveal on resolution', async () => {
    const market = await createMarket(users.owner, group.id, {
      subjectIds: [users.subjB.id],
      closesInMs: 1500,
    });
    await users.sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
    await users.bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 20 });

    await sleep(2000);
    await adminClient.rpc('expire_stale'); // -> closed

    // still blind while closed, odds included
    {
      const { data } = await users.subjB.client.from('visible_markets').select('id').eq('id', market.id);
      expect(data).toEqual([]);
      const { error } = await users.subjB.client.rpc('get_closed_odds', { p_market_id: market.id });
      expect(error?.message).toMatch(/^not_found/);
    }

    await users.sponsor.client.rpc('propose_resolution', {
      p_market_id: market.id,
      p_outcome: 'yes',
      p_justification: null,
      p_actual_value: null,
    });

    // still blind while proposed
    {
      const { data } = await users.subjB.client.from('visible_markets').select('id').eq('id', market.id);
      expect(data).toEqual([]);
    }

    await users.bettor.client.rpc('challenge_resolution', { p_market_id: market.id, p_reason: 'testing' });

    // still blind while disputed
    {
      const { data } = await users.subjB.client.from('visible_markets').select('id').eq('id', market.id);
      expect(data).toEqual([]);
      const { error } = await users.subjB.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
      expect(error?.message).toMatch(/^not_found/);
    }

    await users.sponsor.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    await users.owner.client.rpc('cast_vote', { p_market_id: market.id, p_outcome: 'yes' });
    await backdate('challenges', 'market_id', market.id, 'created_at', 49);
    await adminClient.rpc('finalize_market', { p_market_id: market.id });

    // full reveal now
    const { data: revealed } = await users.subjB.client.from('visible_markets').select('id, status').eq('id', market.id);
    expect(revealed).toHaveLength(1);
    expect(revealed![0].status).toBe('resolved');

    const { data: allBets, error: betsErr } = await users.subjB.client.from('bets').select('user_id, side, amount').eq('market_id', market.id);
    expect(betsErr).toBeNull();
    expect(allBets).toHaveLength(1);
    expect(allBets![0].user_id).toBe(users.bettor.id);
  });

  test('a hidden market returns not_found, never a distinguishable forbidden error', async () => {
    const market = await createMarket(users.owner, group.id, { subjectIds: [users.subjC.id] });
    const { data, error } = await users.subjC.client.from('markets').select('id').eq('id', market.id);
    // RLS denies via zero rows, not an error — this is what the app layer
    // turns into a 404, indistinguishable from "doesn't exist".
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('creator cannot be a subject of their own market', async () => {
    const { error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'invalid',
      p_description: 'invalid',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [users.owner.id],
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });

  test('subject count cap: at most (members - 2), one more is rejected', async () => {
    // group has 5 members; cap allows up to 3 subjects (5 - 2) — exactly at
    // the cap must succeed, one over it must be rejected.
    const { error: atCapErr, data: atCapMarket } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'at the cap',
      p_description: 'valid',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [users.sponsor.id, users.subjB.id, users.subjC.id],
    });
    expect(atCapErr).toBeNull();
    await adminClient.from('markets').delete().eq('id', (atCapMarket as { id: string }).id);

    const { error } = await users.owner.client.rpc('create_market', {
      p_group_id: group.id,
      p_title: 'too many subjects',
      p_description: 'invalid',
      p_market_type: 'yes_no',
      p_closes_at: new Date(Date.now() + 60000).toISOString(),
      p_line: null,
      p_subject_user_ids: [users.sponsor.id, users.subjB.id, users.subjC.id, users.bettor.id],
    });
    expect(error?.message).toMatch(/invalid_operation/);
  });
});

describe('cross-group isolation', () => {
  let usersA: Record<string, TestUser>;
  let usersB: Record<string, TestUser>;
  let groupA: GroupRow;
  let groupB: GroupRow;

  beforeAll(async () => {
    usersA = await createTestUsers('xgA', ['owner', 'mate']);
    usersB = await createTestUsers('xgB', ['owner', 'mate']);
    groupA = await setupGroup(usersA.owner, [usersA.mate]);
    groupB = await setupGroup(usersB.owner, [usersB.mate]);
  });

  afterAll(async () => {
    await cleanupTestUsers(usersA);
    await cleanupTestUsers(usersB);
  });

  test('a member of group A sees nothing of group B', async () => {
    const { data: groupData } = await usersA.owner.client.from('groups').select('id').eq('id', groupB.id);
    expect(groupData).toEqual([]);

    const { data: memberData } = await usersA.owner.client.from('memberships').select('id').eq('group_id', groupB.id);
    expect(memberData).toEqual([]);

    const marketB = await createMarket(usersB.owner, groupB.id);
    const { data: marketData, error: marketErr } = await usersA.owner.client.from('markets').select('id').eq('id', marketB.id);
    expect(marketErr).toBeNull();
    expect(marketData).toEqual([]);

    const { error: joinErr } = await usersA.owner.client.rpc('place_bet', {
      p_market_id: marketB.id,
      p_side: 'yes',
      p_amount: 1,
    });
    expect(joinErr?.message).toMatch(/^not_found/);
  });

  test('joining group B does not grant retroactive membership in group A', async () => {
    const { data } = await usersB.owner.client.from('groups').select('id').eq('id', groupA.id);
    expect(data).toEqual([]);
  });
});
