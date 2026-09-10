import { createClient } from '@/lib/supabase/server';
import { MarketComments, type MarketCommentView } from '@/components/markets/MarketComments';
import type { Market } from '@/lib/actions/markets';

/**
 * The one line the market page template mounts: fetches the thread and the viewer's role,
 * then renders MarketComments. Self-contained on purpose, so both the market page and the
 * reveal page mount it with the same line and neither has to grow a comments query of its own.
 *
 * Reads market_comments through RLS (the is_market_visible() choke point, deleted rows
 * excluded by the policy), then looks nicknames up on memberships the way the market page
 * does for bets and clarifications, since nicknames are per group. Renders nothing at all in
 * a public group: comments are off there (add_market_comment refuses too), see
 * ARCHITECTURE.md's design-decision note.
 */
export async function MarketCommentsSection({ groupId, marketId, status }: { groupId: string; marketId: string; status: Market['status'] }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: group }, { data: membership }, { data: rows }] = await Promise.all([
    supabase.from('groups').select('owner_id, is_public').eq('id', groupId).single(),
    supabase.from('memberships').select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle(),
    supabase.from('market_comments').select('id, user_id, body, created_at').eq('market_id', marketId).order('created_at'),
  ]);
  if (!group || group.is_public) return null;

  const comments = (rows ?? []) as { id: string; user_id: string | null; body: string; created_at: string }[];
  const authorIds = [...new Set(comments.map((c) => c.user_id).filter((id): id is string => id !== null))];
  const { data: authors } =
    authorIds.length > 0
      ? await supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', authorIds)
      : { data: [] as { user_id: string; nickname: string }[] };
  const nicknameByUserId = new Map((authors ?? []).map((m) => [m.user_id, m.nickname as string]));

  const view: MarketCommentView[] = comments.map((c) => ({
    id: c.id,
    userId: c.user_id,
    nickname: c.user_id ? (nicknameByUserId.get(c.user_id) ?? null) : null,
    body: c.body,
    createdAt: c.created_at,
  }));

  return (
    <MarketComments
      groupId={groupId}
      marketId={marketId}
      comments={view}
      viewerId={user.id}
      canModerate={group.owner_id === user.id || membership?.role === 'moderator'}
      closed={status === 'voided'}
    />
  );
}
