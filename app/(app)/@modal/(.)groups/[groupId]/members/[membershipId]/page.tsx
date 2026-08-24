import { MemberProfileModal } from '@/components/groups/MemberProfileModal';
import { getMemberProfileData } from '@/lib/memberProfile';

/**
 * The intercepted version of `groups/[groupId]/members/[membershipId]` — a same-app tap on a
 * name (leaderboard row, an award's "held by" row, ...) lands here instead of a full page
 * navigation, per the `(.)` convention matching this route at the same level `@modal` itself
 * sits at (see app/(app)/layout.tsx for where the `modal` slot renders). A direct link, a shared
 * URL, or a hard refresh bypass this entirely and hit the real page instead — see that page's own
 * comment. `MemberProfileModal` owns the `RouteModal` shell itself, since it also drives the
 * compare-with-someone steps sliding within the same panel.
 */
export default async function MemberProfileModalRoute({
  params,
}: {
  params: Promise<{ groupId: string; membershipId: string }>;
}) {
  const { groupId, membershipId } = await params;
  const data = await getMemberProfileData(groupId, membershipId);

  return <MemberProfileModal data={data} />;
}
