import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { ScreenHeader } from '@/components/ui/Screen';
import { InviteScreen } from '@/components/groups/InviteScreen';
import { loadInviteJoiners } from '@/lib/inviteJoiners';

/** 5m: "Invite to {group}" — reached from the invite card's Share on Group setup / Manage group. */
export default async function InvitePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: group } = await supabase.from('groups').select('id, name, invite_code, owner_id, is_public').eq('id', groupId).single();
  notFoundIfEmpty(group);
  // A public group has no invite code to hand out — anyone joins from the directory.
  if (group!.is_public) notFound();

  const joiners = await loadInviteJoiners(supabase, groupId, [group!.owner_id, user.id]);

  return (
    <>
      <ScreenHeader title={`Invite to ${group!.name}`} href={`/groups/${groupId}/settings`} />
      <main className="mx-auto max-w-[430px] px-[22px] pt-5 pb-10">
        <InviteScreen groupId={groupId} groupName={group!.name} inviteCode={group!.invite_code} joiners={joiners} canReset={group!.owner_id === user.id} />
      </main>
    </>
  );
}
