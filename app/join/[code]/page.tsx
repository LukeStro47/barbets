import { redirect } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { friendlyMessage, toActionError } from '@/lib/errors';
import { JoinFlow } from '@/components/groups/JoinFlow';
import { InvalidInviteModal } from '@/components/groups/InvalidInviteModal';
import { normalizeInviteCode } from '@/lib/inviteCode';

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  // Codes printed on cards, or shared before the prefix was dropped, still read "BB-XXXX" — those
  // links have to keep working, so the URL is normalized once here and only the clean code is
  // used from this point on (lookup, the sign-in bounce-back, and JoinFlow's own join call).
  const code = normalizeInviteCode(rawCode);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const nextParam = `/join/${encodeURIComponent(code)}`;
  if (!user) {
    redirect(`/login?next=${nextParam}`);
  }

  const { data: group, error } = (await supabase.rpc('get_group_by_invite_code', { p_invite_code: code }).maybeSingle()) as {
    data: { id: string; name: string; accepting_members: boolean; my_status: string | null } | null;
    error: PostgrestError | null;
  };

  // A wrong code isn't an error here (it comes back as zero rows), so the only thing this lookup
  // ever raises is the invite-code rate limit. Anything else is a genuine failure and belongs in
  // the error boundary and the Slack report, not quietly dressed up as a bad invite.
  if (error) {
    const actionError = toActionError(error);
    if (actionError.code !== 'invalid_operation') throw actionError;
    // Postgres error copy never carries a trailing period (it usually renders inline under a form
    // field). This one is a modal headline, so it gets one.
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <InvalidInviteModal
          title={`${friendlyMessage(actionError)}.`}
          body="Codes are limited to a few tries at a time, so nobody can guess their way into a group."
        />
      </main>
    );
  }

  if (!group) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <InvalidInviteModal />
      </main>
    );
  }

  const blockedReason =
    group.my_status === 'removed' ? 'removed' : group.my_status === null && !group.accepting_members ? 'not_accepting' : null;

  // No padding or centering here: JoinFlow's two steps are laid out differently (the confirm
  // step centers on the group, the nickname step is a top-aligned form screen), so each owns
  // its own gutters and safe-area inset.
  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      <JoinFlow inviteCode={code} groupName={group.name} blockedReason={blockedReason} />
    </main>
  );
}
