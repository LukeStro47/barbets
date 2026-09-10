import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, backdate, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, sleep, type GroupRow, type MarketRow } from './helpers/scenarios';

interface CommentRow {
  id: string;
  market_id: string;
  user_id: string | null;
  body: string;
  created_at: string;
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

/** create_market -> pending_sponsor (endorsement is on by default) -> sponsor_market -> open. */
async function createOpenMarket(creator: TestUser, sponsor: TestUser, groupId: string, opts: { subjectIds?: string[] } = {}): Promise<MarketRow> {
  const market = await createMarket(creator, groupId, { subjectIds: opts.subjectIds, closesInMs: 60_000 });
  const { error } = await sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
  if (error) throw new Error(`sponsor_market: ${error.message}`);
  return market;
}

/** Drives an open market to `resolved` via the unchallenged auto-finalize path. */
async function resolveMarket(market: MarketRow, proposer: TestUser) {
  await fastForwardCloseTime(market.id, 1500);
  await sleep(2000);
  await adminClient.rpc('expire_stale'); // -> closed
  const { error } = await proposer.client.rpc('propose_resolution', {
    p_market_id: market.id,
    p_outcome: 'yes',
    p_justification: null,
    p_actual_value: null,
  });
  if (error) throw new Error(`propose_resolution: ${error.message}`);
  await backdate('resolution_proposals', 'market_id', market.id, 'proposed_at', 9);
  const { error: finalizeErr } = await adminClient.rpc('finalize_market', { p_market_id: market.id });
  if (finalizeErr) throw new Error(`finalize_market: ${finalizeErr.message}`);
}

async function addComment(user: TestUser, marketId: string, body: string): Promise<CommentRow> {
  const { data, error } = await user.client.rpc('add_market_comment', { p_market_id: marketId, p_body: body });
  if (error) throw new Error(`add_market_comment (${user.tag}): ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as CommentRow;
}

async function heatingUpEvents(marketId: string) {
  const { data, error } = await adminClient
    .from('notification_events')
    .select('id, actor_id, group_id, created_at')
    .eq('event_type', 'market_comments_heating_up')
    .eq('market_id', marketId)
    .order('created_at');
  if (error) throw error;
  return data;
}

async function recipientIds(eventId: string): Promise<string[]> {
  const { data, error } = await adminClient.rpc('get_event_recipients', { p_event_id: eventId });
  if (error) throw error;
  return (data as { user_id: string }[]).map((r) => r.user_id).sort();
}

async function unreadCounts(user: TestUser, marketIds: string[]): Promise<{ market_id: string; unread_count: number }[]> {
  const { data, error } = await user.client.rpc('get_unread_comment_counts', { p_market_ids: marketIds });
  if (error) throw error;
  return data ?? [];
}

describe('market comments', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('cmt', ['owner', 'a', 'b', 'c', 'subject']);
    group = await setupGroup(users.owner, [users.a, users.b, users.c, users.subject]);
    for (const u of Object.values(users)) await subscribe(u);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('a subject gets not_found on every RPC and an empty select before resolution, and sees the thread after', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id, { subjectIds: [users.subject.id] });
    await addComment(users.a, market.id, 'no spoilers');

    const { error: addErr } = await users.subject.client.rpc('add_market_comment', { p_market_id: market.id, p_body: 'what is this' });
    expect(addErr?.message).toMatch(/^not_found/);

    const { error: readErr } = await users.subject.client.rpc('mark_market_comments_read', { p_market_id: market.id });
    expect(readErr?.message).toMatch(/^not_found/);

    const { data: hidden, error: selectErr } = await users.subject.client.from('market_comments').select('id').eq('market_id', market.id);
    expect(selectErr).toBeNull();
    expect(hidden).toEqual([]);
    expect(await unreadCounts(users.subject, [market.id])).toEqual([]);

    await resolveMarket(market, users.a);

    const { data: visible } = await users.subject.client.from('market_comments').select('body').eq('market_id', market.id);
    expect(visible?.map((c) => c.body)).toEqual(['no spoilers']);
    expect(await unreadCounts(users.subject, [market.id])).toEqual([{ market_id: market.id, unread_count: 1 }]);

    const posted = await addComment(users.subject, market.id, 'oh, it was about me');
    expect(posted.user_id).toBe(users.subject.id);
  });

  test('a non-member gets not_found from every comment RPC, never a distinguishable error', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);
    const comment = await addComment(users.a, market.id, 'members only');
    const outsider = await createTestUsers('cmto', ['x']);
    try {
      const x = outsider.x.client;
      const add = await x.rpc('add_market_comment', { p_market_id: market.id, p_body: 'hello?' });
      expect(add.error?.message).toMatch(/^not_found/);
      const read = await x.rpc('mark_market_comments_read', { p_market_id: market.id });
      expect(read.error?.message).toMatch(/^not_found/);
      const del = await x.rpc('delete_market_comment', { p_comment_id: comment.id });
      expect(del.error?.message).toMatch(/^not_found/);
      const report = await x.rpc('report_market_comment', { p_comment_id: comment.id, p_reason: 'nope' });
      expect(report.error?.message).toMatch(/^not_found/);

      const { data, error } = await x.from('market_comments').select('id').eq('market_id', market.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await unreadCounts(outsider.x, [market.id])).toEqual([]);

      // A nonexistent market reads identically.
      const ghost = await x.rpc('add_market_comment', { p_market_id: '00000000-0000-0000-0000-000000000000', p_body: 'hello?' });
      expect(ghost.error?.message).toMatch(/^not_found/);
    } finally {
      await cleanupTestUsers(outsider);
    }
  });

  test('five comments inside a minute emit exactly one heating-up event, with the right recipients, and the hour is a lid', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id, { subjectIds: [users.subject.id] });

    // A comment on its own sends nothing, and neither do four.
    await addComment(users.a, market.id, 'one');
    await addComment(users.a, market.id, 'two');
    // b opens the thread mid-burst: they've seen it heating up, so they must not be pushed.
    const { error: bReadErr } = await users.b.client.rpc('mark_market_comments_read', { p_market_id: market.id });
    expect(bReadErr).toBeNull();
    await addComment(users.a, market.id, 'three');
    await addComment(users.a, market.id, 'four');
    expect(await heatingUpEvents(market.id)).toHaveLength(0);

    // The fifth tips it over.
    await addComment(users.a, market.id, 'five');
    const events = await heatingUpEvents(market.id);
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe(users.a.id);
    expect(events[0].group_id).toBe(group.id);

    const recipients = await recipientIds(events[0].id);
    expect(recipients).not.toContain(users.a.id); // the commenter
    expect(recipients).not.toContain(users.b.id); // opened the thread after the burst began
    expect(recipients).not.toContain(users.subject.id); // hidden subject, as everywhere else
    expect(recipients).toContain(users.owner.id); // never opened it
    expect(recipients).toContain(users.c.id); // never opened it

    // Ten more inside the same hour: still exactly one.
    for (let i = 0; i < 10; i++) {
      await addComment(i % 2 === 0 ? users.a : users.c, market.id, `more ${i}`);
    }
    expect(await heatingUpEvents(market.id)).toHaveLength(1);

    // Once the last event is over an hour old, the next burst is allowed to push again.
    await backdate('notification_events', 'id', events[0].id, 'created_at', 2);
    await addComment(users.c, market.id, 'and again');
    const later = await heatingUpEvents(market.id);
    expect(later).toHaveLength(2);
    expect(later[1].actor_id).toBe(users.c.id);
  });

  test('a member who opened the thread before the burst is still told about it', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);
    const { error } = await users.b.client.rpc('mark_market_comments_read', { p_market_id: market.id });
    expect(error).toBeNull();
    for (const body of ['1', '2', '3', '4', '5']) await addComment(users.a, market.id, body);
    const events = await heatingUpEvents(market.id);
    expect(events).toHaveLength(1);
    expect(await recipientIds(events[0].id)).toContain(users.b.id);
  });

  test("the card's unread count follows the viewer's last look and never counts their own comments", async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);
    await addComment(users.a, market.id, 'first');
    await addComment(users.a, market.id, 'second');

    expect(await unreadCounts(users.b, [market.id])).toEqual([{ market_id: market.id, unread_count: 2 }]);
    expect(await unreadCounts(users.a, [market.id])).toEqual([]);

    const { error } = await users.b.client.rpc('mark_market_comments_read', { p_market_id: market.id });
    expect(error).toBeNull();
    expect(await unreadCounts(users.b, [market.id])).toEqual([]);

    await addComment(users.a, market.id, 'third');
    expect(await unreadCounts(users.b, [market.id])).toEqual([{ market_id: market.id, unread_count: 1 }]);

    // The viewer's own read marker is the only market_comment_reads row they can see.
    const { data: mine } = await users.b.client.from('market_comment_reads').select('user_id').eq('market_id', market.id);
    expect(mine).toEqual([{ user_id: users.b.id }]);
    const { data: theirs } = await users.a.client.from('market_comment_reads').select('user_id').eq('market_id', market.id);
    expect(theirs).toEqual([]);
  });

  test('delete: the author and the group owner can, a plain member cannot, and a deleted comment disappears', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);
    const c1 = await addComment(users.a, market.id, 'mine to remove');
    const c2 = await addComment(users.a, market.id, 'the owner removes this one');

    const { error: plainErr } = await users.b.client.rpc('delete_market_comment', { p_comment_id: c1.id });
    expect(plainErr?.message).toMatch(/^forbidden/);

    const { error: authorErr } = await users.a.client.rpc('delete_market_comment', { p_comment_id: c1.id });
    expect(authorErr).toBeNull();
    const { error: ownerErr } = await users.owner.client.rpc('delete_market_comment', { p_comment_id: c2.id });
    expect(ownerErr).toBeNull();

    const { data: remaining } = await users.b.client.from('market_comments').select('id').eq('market_id', market.id);
    expect(remaining).toEqual([]);
    expect(await unreadCounts(users.b, [market.id])).toEqual([]);

    // Gone for every RPC too, and the row itself is kept as an audit trail.
    const { error: againErr } = await users.a.client.rpc('delete_market_comment', { p_comment_id: c1.id });
    expect(againErr?.message).toMatch(/^not_found/);
    const { data: audit } = await adminClient.from('market_comments').select('deleted_at, deleted_by').eq('id', c2.id).single();
    expect(audit?.deleted_at).not.toBeNull();
    expect(audit?.deleted_by).toBe(users.owner.id);
  });

  test('reporting a comment writes a feedback row that names the comment, its author, the market and the group', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);
    const comment = await addComment(users.a, market.id, 'something\nobjectionable');

    const { data, error } = await users.b.client.rpc('report_market_comment', { p_comment_id: comment.id, p_reason: 'rude' });
    expect(error).toBeNull();
    const row = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      user_id: string;
      category: string;
      group_id: string | null;
      page_url: string | null;
      message: string;
    };
    try {
      expect(row.user_id).toBe(users.b.id);
      expect(row.category).toBe('general');
      expect(row.group_id).toBe(group.id);
      expect(row.page_url).toBe(`/groups/${group.id}/markets/${market.id}`);
      expect(row.message).toContain(comment.id);
      expect(row.message).toContain(`@${users.a.tag}`);
      expect(row.message).toContain(market.id);
      expect(row.message).toContain(group.id);
      expect(row.message).toContain('> something\n> objectionable');
      expect(row.message).toContain('Reason: rude');

      // The feedback table stays zero-policy: the reporter can't read their own report back.
      const { data: leaked } = await users.b.client.from('feedback').select('id').eq('id', row.id);
      expect(leaked).toEqual([]);
    } finally {
      await adminClient.from('feedback').delete().eq('id', row.id);
    }
  });

  test('body rules: blank and over-cap are rejected, the cap itself and newlines are kept', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);

    const blank = await users.a.client.rpc('add_market_comment', { p_market_id: market.id, p_body: '  \n\t ' });
    expect(blank.error?.message).toMatch(/^invalid_operation/);
    const over = await users.a.client.rpc('add_market_comment', { p_market_id: market.id, p_body: 'x'.repeat(501) });
    expect(over.error?.message).toMatch(/^invalid_operation/);

    const atCap = await addComment(users.a, market.id, 'x'.repeat(500));
    expect(atCap.body).toHaveLength(500);
    const multi = await addComment(users.a, market.id, '  line one\r\n\r\nline two  \n');
    expect(multi.body).toBe('line one\n\nline two');
  });

  test('a voided market takes no new comments', async () => {
    const market = await createOpenMarket(users.owner, users.a, group.id);
    await addComment(users.a, market.id, 'before the void');
    const { error: voidErr } = await users.owner.client.rpc('void_market_by_owner', { p_market_id: market.id });
    expect(voidErr).toBeNull();

    const { error } = await users.a.client.rpc('add_market_comment', { p_market_id: market.id, p_body: 'after the void' });
    expect(error?.message).toMatch(/^invalid_operation/);
    const { data } = await users.b.client.from('market_comments').select('body').eq('market_id', market.id);
    expect(data?.map((c) => c.body)).toEqual(['before the void']);
  });
});

describe('market comments in a public group', () => {
  let users: Record<string, TestUser>;

  beforeAll(async () => {
    users = await createTestUsers('cmtp', ['admin', 'member']);
    const { error } = await adminClient.from('app_admins').insert({ user_id: users.admin.id });
    if (error) throw new Error(`app_admins: ${error.message}`);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('comments are off: add_market_comment is refused for everyone, moderator included', async () => {
    const { data, error } = await users.admin.client.rpc('create_public_group', {
      p_name: `Public Comments ${Date.now()}`,
      p_category: 'generic',
      p_seed_amount: 1000,
      p_nickname: users.admin.tag,
      p_timezone: 'UTC',
    });
    if (error || !data) throw new Error(`create_public_group: ${error?.message}`);
    const group = (Array.isArray(data) ? data[0] : data) as GroupRow;

    const { error: joinErr } = await users.member.client.rpc('join_public_group', { p_group_id: group.id, p_nickname: users.member.tag });
    expect(joinErr).toBeNull();

    // A public group's market opens straight away (no endorsement), created by the owner/mod.
    const market = await createMarket(users.admin, group.id, { closesInMs: 60_000 });
    expect(market.status).toBe('open');

    const asMember = await users.member.client.rpc('add_market_comment', { p_market_id: market.id, p_body: 'hello' });
    expect(asMember.error?.message).toMatch(/^invalid_operation/);
    const asOwner = await users.admin.client.rpc('add_market_comment', { p_market_id: market.id, p_body: 'hello' });
    expect(asOwner.error?.message).toMatch(/^invalid_operation/);

    const { data: none } = await users.member.client.from('market_comments').select('id').eq('market_id', market.id);
    expect(none).toEqual([]);
  });
});
