import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JoinFlow } from '@/components/groups/JoinFlow';
import { InvalidInviteModal } from '@/components/groups/InvalidInviteModal';

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const nextParam = `/join/${encodeURIComponent(code)}`;
  if (!user) {
    redirect(`/login?next=${nextParam}`);
  }

  const { data: group } = (await supabase.rpc('get_group_by_invite_code', { p_invite_code: code }).maybeSingle()) as {
    data: { id: string; name: string; accepting_members: boolean; my_status: string | null } | null;
  };

  if (!group) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <InvalidInviteModal />
      </main>
    );
  }

  const blockedReason =
    group.my_status === 'removed' ? 'removed' : group.my_status === null && !group.accepting_members ? 'not_accepting' : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12">
      <JoinFlow inviteCode={code} groupName={group.name} blockedReason={blockedReason} />
    </main>
  );
}
