import { PageHeader } from '@/components/ui/PageHeader';
import { MemberProfileCard } from '@/components/groups/MemberProfileCard';
import { getMemberProfileData } from '@/lib/memberProfile';

/**
 * The full-page fallback for a member's record: a direct link, a shared URL, or a hard refresh
 * while the modal version (`@modal/(.)groups/.../page.tsx`) is open all land here instead, since
 * an intercepted route only intercepts a same-app soft navigation. Tapping a name from the
 * leaderboard or the awards page normally opens the modal version — see the design note on why
 * this is a modal now rather than always a full page.
 */
export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ groupId: string; membershipId: string }>;
}) {
  const { groupId, membershipId } = await params;
  const data = await getMemberProfileData(groupId, membershipId);

  return (
    <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
      <PageHeader title="Member record" backHref={`/groups/${groupId}/leaderboard`} backLabel="Leaderboard" />
      <MemberProfileCard data={data} />
    </main>
  );
}
