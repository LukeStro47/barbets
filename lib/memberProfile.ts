import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { titlesByUser, type GroupTitleRow, type TitleBadge } from '@/lib/titles';
import { formatOrdinal } from '@/lib/formatNumber';

export interface MemberStats {
  membership_id: string;
  group_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  joined_at: string;
  net: number;
  accuracy_pct: number | null;
  settled_bet_count: number;
  tokens_wagered: number;
  best_call_multiple: number | null;
  best_call_title: string | null;
}

export interface MemberProfileData {
  stats: MemberStats;
  groupId: string;
  groupName: string;
  standing: string;
  badges: TitleBadge[];
  others: { id: string; nickname: string }[];
  /** The viewer's own membership id in this group, so the compare picker can label their own row
   *  "@me" instead of listing them under their nickname like anyone else. Null in the (should be
   *  unreachable, since get_member_stats already requires an active/dormant caller) case the
   *  viewer's own row isn't found among this group's current members. */
  meMembershipId: string | null;
  isYou: boolean;
  net: number;
  sinceLabel: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
}

/**
 * Everything the member profile needs, shared by the full-page route
 * (`groups/[groupId]/members/[membershipId]/page.tsx`, the fallback for a direct link or a
 * refresh) and the intercepted modal route (`@modal/(.)groups/.../page.tsx`, what a same-app tap
 * on a name actually opens) — one query path, two presentations of the same content.
 *
 * `get_member_stats()` is the actual privacy gate (see its migration); this just renders what it
 * returns. A raised `not_found` (hidden, removed, or genuinely nonexistent) and a bad
 * `membershipId` both surface as the ordinary `notFoundIfEmpty()` 404.
 */
export async function getMemberProfileData(groupId: string, membershipId: string): Promise<MemberProfileData> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data } = await supabase.rpc('get_member_stats', { p_membership_id: membershipId });
  const stats = notFoundIfEmpty<MemberStats>(data);
  if (stats.group_id !== groupId) notFound();

  const [{ data: group }, { data: groupMembers }, { data: titleRows }, { data: avatarRow }] = await Promise.all([
    supabase.from('groups').select('name').eq('id', groupId).single(),
    supabase.from('memberships').select('id, user_id, nickname, balance').eq('group_id', groupId).in('status', ['active', 'dormant']),
    supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId),
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', stats.user_id).single(),
  ]);

  // Same rank definition every other page uses: currently-playing members sorted by balance
  // descending. A member who has since gone dormant/left just doesn't have a current rank.
  const ranked = [...(groupMembers ?? [])].sort((a, b) => b.balance - a.balance);
  const rankIndex = ranked.findIndex((m) => m.user_id === stats.user_id);
  const standing = rankIndex >= 0 ? `${formatOrdinal(rankIndex + 1)} of ${ranked.length}` : 'Not currently playing';

  const badges = titlesByUser((titleRows ?? []) as GroupTitleRow[]).get(stats.user_id) ?? [];
  const others = (groupMembers ?? [])
    .filter((m) => m.id !== stats.membership_id)
    .map((m) => ({ id: m.id, nickname: m.nickname ?? '' }));
  const meMembershipId = (groupMembers ?? []).find((m) => m.user_id === user.id)?.id ?? null;
  const isYou = stats.user_id === user.id;
  const net = Number(stats.net);
  const sinceLabel = new Date(stats.joined_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return {
    stats,
    groupId,
    groupName: group?.name ?? '',
    standing,
    badges,
    others,
    meMembershipId,
    isYou,
    net,
    sinceLabel,
    avatarUpdatedAt: avatarRow?.avatar_updated_at ?? null,
    avatarPresetKey: avatarRow?.avatar_preset_key ?? null,
  };
}
