'use server';

import { createClient, requireUser } from '@/lib/supabase/server';
import { friendlyMessage, toActionError, type ActionResult } from '@/lib/errors';
import type { HeadToHeadData, HeadToHeadMemberStats, HeadToHeadMarket } from '@/lib/headToHead';

/**
 * The data behind `CompareMemberPicker`'s inline "comparing" step — a read, not a mutation, but
 * still funneled through `ActionResult` rather than `notFound()`: this runs from a client
 * component's own state, not a page render, so there is no route boundary for `notFound()` to
 * resolve against. `get_member_stats`/`get_head_to_head_markets` are the actual privacy gate
 * (both raise `not_found: ...` for a hidden/removed/nonexistent membership); a race between the
 * picker listing a member and the fetch running is the only realistic way this errors, so the
 * client just shows the message and offers Back rather than anything more specific.
 *
 * The full-page fallback (`groups/[groupId]/members/[membershipId]/vs/[otherMembershipId]/page.tsx`)
 * fetches the same two RPCs directly and leans on `notFoundIfEmpty()` instead, since it *is* a
 * route render — same data, two error-handling idioms, matching `getMemberProfileData` vs. this.
 */
export async function loadHeadToHead(
  groupId: string,
  membershipId: string,
  otherMembershipId: string
): Promise<ActionResult<HeadToHeadData>> {
  const supabase = await createClient();
  await requireUser(supabase);

  const [aRes, bRes, marketsRes] = await Promise.all([
    supabase.rpc('get_member_stats', { p_membership_id: membershipId }),
    supabase.rpc('get_member_stats', { p_membership_id: otherMembershipId }),
    supabase.rpc('get_head_to_head_markets', { p_membership_id_a: membershipId, p_membership_id_b: otherMembershipId }),
  ]);

  if (aRes.error) return { error: friendlyMessage(toActionError(aRes.error)) };
  if (bRes.error) return { error: friendlyMessage(toActionError(bRes.error)) };
  if (marketsRes.error) return { error: friendlyMessage(toActionError(marketsRes.error)) };

  const aStats = Array.isArray(aRes.data) ? aRes.data[0] : aRes.data;
  const bStats = Array.isArray(bRes.data) ? bRes.data[0] : bRes.data;
  if (!aStats || !bStats || aStats.group_id !== groupId || bStats.group_id !== groupId) {
    return { error: 'Could not load that comparison.' };
  }

  const [{ data: aAvatar }, { data: bAvatar }] = await Promise.all([
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', aStats.user_id).single(),
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', bStats.user_id).single(),
  ]);

  function toMemberStats(stats: typeof aStats, avatar: typeof aAvatar): HeadToHeadMemberStats {
    return {
      membership_id: stats.membership_id,
      group_id: stats.group_id,
      user_id: stats.user_id,
      nickname: stats.nickname,
      balance: stats.balance,
      net: Number(stats.net),
      accuracy_pct: stats.accuracy_pct,
      tokens_wagered: Number(stats.tokens_wagered),
      avatarUpdatedAt: avatar?.avatar_updated_at ?? null,
      avatarPresetKey: avatar?.avatar_preset_key ?? null,
    };
  }

  return {
    data: {
      a: toMemberStats(aStats, aAvatar),
      b: toMemberStats(bStats, bAvatar),
      markets: (marketsRes.data ?? []) as HeadToHeadMarket[],
    },
  };
}
