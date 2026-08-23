import { RouteModal } from '@/components/ui/RouteModal';
import { MemberProfileCard } from '@/components/groups/MemberProfileCard';
import { getMemberProfileData } from '@/lib/memberProfile';

/**
 * The intercepted version of `groups/[groupId]/members/[membershipId]` — a same-app tap on a
 * name (leaderboard row, an award's "held by" row, ...) lands here instead of a full page
 * navigation, per the `(.)` convention matching this route at the same level `@modal` itself
 * sits at (see app/(app)/layout.tsx for where the `modal` slot renders). A direct link, a shared
 * URL, or a hard refresh bypass this entirely and hit the real page instead — see that page's own
 * comment.
 */
export default async function MemberProfileModal({
  params,
}: {
  params: Promise<{ groupId: string; membershipId: string }>;
}) {
  const { groupId, membershipId } = await params;
  const data = await getMemberProfileData(groupId, membershipId);

  return (
    <RouteModal>
      <MemberProfileCard data={data} />
    </RouteModal>
  );
}
