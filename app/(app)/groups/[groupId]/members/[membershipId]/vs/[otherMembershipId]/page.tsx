import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { HeadToHeadCard } from '@/components/groups/HeadToHeadCard';
import type { HeadToHeadMemberStats, HeadToHeadMarket } from '@/lib/headToHead';

interface MemberStatsRow {
  membership_id: string;
  group_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  net: number;
  accuracy_pct: number | null;
  tokens_wagered: number;
}

/**
 * The full-page fallback for a head-to-head comparison: a direct link, a shared URL, or a hard
 * refresh land here. A same-app tap on "Compare with someone" normally never reaches this route
 * at all any more — it's handled inline by `CompareMemberPicker`'s own modal step (fetching
 * through `loadHeadToHead`, see lib/actions/memberProfile.ts) so comparing stays inside the
 * member-profile modal with a Back button instead of leaving it. This page exists for the direct
 * case only, sharing `HeadToHeadCard` (the actual comparison content) with that inline step.
 */
export default async function HeadToHeadPage({
  params,
}: {
  params: Promise<{ groupId: string; membershipId: string; otherMembershipId: string }>;
}) {
  const { groupId, membershipId, otherMembershipId } = await params;
  const supabase = await createClient();

  const [{ data: aData }, { data: bData }, { data: marketsData }] = await Promise.all([
    supabase.rpc('get_member_stats', { p_membership_id: membershipId }),
    supabase.rpc('get_member_stats', { p_membership_id: otherMembershipId }),
    supabase.rpc('get_head_to_head_markets', { p_membership_id_a: membershipId, p_membership_id_b: otherMembershipId }),
  ]);

  const a = notFoundIfEmpty<MemberStatsRow>(aData);
  const b = notFoundIfEmpty<MemberStatsRow>(bData);
  if (a.group_id !== groupId || b.group_id !== groupId) notFound();

  const markets = (marketsData ?? []) as HeadToHeadMarket[];

  const [{ data: aAvatar }, { data: bAvatar }] = await Promise.all([
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', a.user_id).single(),
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', b.user_id).single(),
  ]);

  const aStats: HeadToHeadMemberStats = {
    ...a,
    net: Number(a.net),
    tokens_wagered: Number(a.tokens_wagered),
    avatarUpdatedAt: aAvatar?.avatar_updated_at ?? null,
    avatarPresetKey: aAvatar?.avatar_preset_key ?? null,
  };
  const bStats: HeadToHeadMemberStats = {
    ...b,
    net: Number(b.net),
    tokens_wagered: Number(b.tokens_wagered),
    avatarUpdatedAt: bAvatar?.avatar_updated_at ?? null,
    avatarPresetKey: bAvatar?.avatar_preset_key ?? null,
  };

  return (
    <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
      <PageHeader title="Head to head" backHref={`/groups/${groupId}/members/${membershipId}`} backLabel="Back" />
      <HeadToHeadCard data={{ a: aStats, b: bStats, markets }} />
    </main>
  );
}
