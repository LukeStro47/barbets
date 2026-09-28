import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestUsers, cleanupTestUsers, adminClient, type TestUser } from './helpers/testUsers';
import { setupGroup, createMarket, fastForwardCloseTime, sleep, type GroupRow, type MarketRow } from './helpers/scenarios';

/** A sponsored, open market ready to take bets and comments. */
async function openMarket(owner: TestUser, sponsor: TestUser, groupId: string, opts: { subjectIds?: string[] } = {}): Promise<MarketRow> {
  const market = await createMarket(owner, groupId, { subjectIds: opts.subjectIds, closesInMs: 60_000 });
  await sponsor.client.rpc('sponsor_market', { p_market_id: market.id });
  return market;
}

/** post_market_comment/reveal_bet_in_comment return the `market_comments` row type — same
 *  array-or-object defensive unwrap createMarket()/runRpc() already use for any RPC returning a
 *  single row, rather than assuming the raw client always gives back a plain object. */
interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  revealed_side: string | null;
  revealed_option_id: string | null;
  revealed_amount: number | null;
}
function unwrapComment(data: CommentRow | CommentRow[]): CommentRow {
  return Array.isArray(data) ? data[0] : data;
}

describe('market comments', () => {
  let users: Record<string, TestUser>;
  let group: GroupRow;

  beforeAll(async () => {
    users = await createTestUsers('cmt', ['owner', 'sponsor', 'subject', 'bettor']);
    group = await setupGroup(users.owner, [users.sponsor, users.subject, users.bettor]);
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  test('post, list, and delete as a normal member', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);

    const { data: postedRaw, error: postErr } = await users.bettor.client.rpc('post_market_comment', {
      p_market_id: market.id,
      p_body: 'Genuinely no idea why I am this confident.',
    });
    expect(postErr).toBeNull();
    const posted = unwrapComment(postedRaw);
    expect(posted.body).toBe('Genuinely no idea why I am this confident.');
    expect(posted.user_id).toBe(users.bettor.id);
    expect(posted.revealed_amount).toBeNull();

    const { data: listed } = await users.sponsor.client
      .from('market_comments')
      .select('id, body')
      .eq('market_id', market.id)
      .is('deleted_at', null);
    expect(listed).toHaveLength(1);
    expect(listed![0].id).toBe(posted.id);

    // Only the author can delete their own comment.
    const { error: forbiddenErr } = await users.sponsor.client.rpc('delete_market_comment', { p_comment_id: posted.id });
    expect(forbiddenErr?.message).toMatch(/^forbidden/);

    const { error: deleteErr } = await users.bettor.client.rpc('delete_market_comment', { p_comment_id: posted.id });
    expect(deleteErr).toBeNull();

    const { data: afterDelete } = await users.sponsor.client
      .from('market_comments')
      .select('id')
      .eq('market_id', market.id)
      .is('deleted_at', null);
    expect(afterDelete).toEqual([]);
  });

  test('an empty or oversized comment is rejected', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);

    const { error: emptyErr } = await users.bettor.client.rpc('post_market_comment', { p_market_id: market.id, p_body: '   ' });
    expect(emptyErr?.message).toMatch(/^invalid_operation/);

    const { error: tooLongErr } = await users.bettor.client.rpc('post_market_comment', {
      p_market_id: market.id,
      p_body: 'x'.repeat(2001),
    });
    expect(tooLongErr?.message).toMatch(/^invalid_operation/);
  });

  test('a hidden subject gets not_found on the RPC and sees nothing on a direct select', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id, { subjectIds: [users.subject.id] });
    await users.bettor.client.rpc('post_market_comment', { p_market_id: market.id, p_body: 'Talking about the subject market.' });

    const { error: postErr } = await users.subject.client.rpc('post_market_comment', { p_market_id: market.id, p_body: 'Can I see this?' });
    expect(postErr?.message).toMatch(/^not_found/);

    const { data: list, error: selectErr } = await users.subject.client.from('market_comments').select('id').eq('market_id', market.id);
    expect(selectErr).toBeNull();
    expect(list).toEqual([]);
  });

  test('a non-member gets not_found, never a distinguishable forbidden error', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);
    const outsider = await createTestUsers('cmtout', ['x']);
    try {
      const { error } = await outsider.x.client.rpc('post_market_comment', { p_market_id: market.id, p_body: 'Hello from outside' });
      expect(error?.message).toMatch(/^not_found/);

      const { data, error: selectErr } = await outsider.x.client.from('market_comments').select('id').eq('market_id', market.id);
      expect(selectErr).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await cleanupTestUsers(outsider);
    }
  });

  test('reacting to a comment: tapping the same emoji removes it, tapping another swaps it', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);
    const { data: commentRaw } = await users.bettor.client.rpc('post_market_comment', { p_market_id: market.id, p_body: 'React to this.' });
    const comment = unwrapComment(commentRaw);

    const { data: first, error: firstErr } = await users.sponsor.client.rpc('react_to_comment', {
      p_comment_id: comment.id,
      p_emoji: 'fire',
    });
    expect(firstErr).toBeNull();
    expect(first).toBe('fire');

    const { data: cleared } = await users.sponsor.client.rpc('react_to_comment', { p_comment_id: comment.id, p_emoji: 'fire' });
    expect(cleared).toBeNull();

    await users.sponsor.client.rpc('react_to_comment', { p_comment_id: comment.id, p_emoji: 'laugh' });
    const { data: swapped } = await users.sponsor.client.rpc('react_to_comment', { p_comment_id: comment.id, p_emoji: 'clown' });
    expect(swapped).toBe('clown');

    const { data: rows } = await adminClient.from('comment_reactions').select('emoji').eq('comment_id', comment.id).eq('user_id', users.sponsor.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].emoji).toBe('clown');
  });

  test('a comment cannot react to a deleted comment, and a non-member gets not_found reacting', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);
    const { data: commentRaw } = await users.bettor.client.rpc('post_market_comment', { p_market_id: market.id, p_body: 'About to vanish.' });
    const comment = unwrapComment(commentRaw);
    await users.bettor.client.rpc('delete_market_comment', { p_comment_id: comment.id });

    const { error } = await users.sponsor.client.rpc('react_to_comment', { p_comment_id: comment.id, p_emoji: 'fire' });
    expect(error?.message).toMatch(/^not_found/);
  });

  test('revealing a bet snapshots side and amount, and another member cannot see it until the reveal actually ran', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);
    const { error: betErr } = await users.bettor.client.rpc('place_bet', { p_market_id: market.id, p_side: 'yes', p_amount: 40 });
    expect(betErr).toBeNull();

    // Before any reveal: no other member can see the bettor's amount via the comment thread
    // (there's nothing there yet, and bets_select itself still seals it — this is the sealed-bet
    // invariant the reveal feature is not allowed to erode).
    const { data: beforeReveal } = await users.sponsor.client
      .from('bets')
      .select('amount')
      .eq('market_id', market.id)
      .eq('user_id', users.bettor.id);
    expect(beforeReveal).toEqual([]);

    const { data: revealedRaw, error: revealErr } = await users.bettor.client.rpc('reveal_bet_in_comment', {
      p_market_id: market.id,
      p_body: "Showing mine so you all know exactly how much I mean it.",
    });
    expect(revealErr).toBeNull();
    const revealed = unwrapComment(revealedRaw);
    expect(revealed.revealed_side).toBe('yes');
    expect(revealed.revealed_amount).toBe(40);
    expect(revealed.revealed_option_id).toBeNull();

    // Now every member can see the snapshot on the comment itself...
    const { data: seenBySponsor } = await users.sponsor.client
      .from('market_comments')
      .select('revealed_side, revealed_amount')
      .eq('id', revealed.id)
      .single();
    expect(seenBySponsor!.revealed_amount).toBe(40);

    // ...but the underlying bets row is still sealed exactly as before — the reveal published a
    // copy, it did not widen bets_select.
    const { data: stillSealed } = await users.sponsor.client
      .from('bets')
      .select('amount')
      .eq('market_id', market.id)
      .eq('user_id', users.bettor.id);
    expect(stillSealed).toEqual([]);
  });

  test('revealing with no bet on the market is rejected', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);
    const { error } = await users.sponsor.client.rpc('reveal_bet_in_comment', { p_market_id: market.id, p_body: 'I have nothing riding on this.' });
    expect(error?.message).toMatch(/^invalid_operation/);
  });

  test('an @mention in a comment emits exactly one market_comment_mention event', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id);

    const { error } = await users.bettor.client.rpc('post_market_comment', {
      p_market_id: market.id,
      p_body: `@${users.sponsor.tag} you are going to regret this`,
    });
    expect(error).toBeNull();

    await sleep(200);
    const { data: events } = await adminClient
      .from('notification_events')
      .select('id, actor_id, group_id, market_id')
      .eq('market_id', market.id)
      .eq('event_type', 'market_comment_mention');
    expect(events).toHaveLength(1);
    expect(events![0].actor_id).toBe(users.bettor.id);
    expect(events![0].group_id).toBe(group.id);

    // A plain comment with no @token mentioning a real member emits nothing.
    await users.bettor.client.rpc('post_market_comment', { p_market_id: market.id, p_body: 'No mention in this one at all.' });
    await sleep(200);
    const { data: eventsAfter } = await adminClient
      .from('notification_events')
      .select('id')
      .eq('market_id', market.id)
      .eq('event_type', 'market_comment_mention');
    expect(eventsAfter).toHaveLength(1); // unchanged
  });

  test('a mention is addressed to the person named, once, and never to a hidden subject', async () => {
    const market = await openMarket(users.owner, users.sponsor, group.id, { subjectIds: [users.subject.id] });

    const { error } = await users.bettor.client.rpc('post_market_comment', {
      p_market_id: market.id,
      p_body: `@${users.sponsor.tag} and @${users.sponsor.tag.toUpperCase()} again, and @${users.subject.tag} who can't see this`,
    });
    expect(error).toBeNull();

    await sleep(200);
    const { data: events } = await adminClient
      .from('notification_events')
      .select('target_user_id, actor_id')
      .eq('market_id', market.id)
      .eq('event_type', 'market_comment_mention');
    expect(events).toHaveLength(1);
    expect(events![0].target_user_id).toBe(users.sponsor.id);
    expect(events![0].actor_id).toBe(users.bettor.id);
  });
});
