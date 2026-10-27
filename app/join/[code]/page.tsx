import { redirect } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { createClient, createAnonClientWithVisitorIp } from '@/lib/supabase/server';
import { friendlyMessage, toActionError } from '@/lib/errors';
import { JoinFlow, type InviteFace } from '@/components/groups/JoinFlow';
import { SignedOutInvitePreview } from '@/components/groups/SignedOutInvitePreview';
import { InvalidInviteModal } from '@/components/groups/InvalidInviteModal';
import { normalizeInviteCode } from '@/lib/inviteCode';
import { inviteJoinPath, parseJoinSource } from '@/lib/inviteLink';

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ src?: string | string[] }>;
}) {
  const { code: rawCode } = await params;
  // How this invite arrived (`?src=qr` from a scanned QR code, `code` from the four boxes,
  // nothing for a bare link), kept through the sign-in bounce below and handed to join_group
  // as its lifecycle source. Unknown values become null here, never an error.
  const joinSource = parseJoinSource((await searchParams).src);
  // Codes printed on cards, or shared before the prefix was dropped, still read "BB-XXXX" — those
  // links have to keep working, so the URL is normalized once here and only the clean code is
  // used from this point on (lookup, the sign-in bounce-back, and JoinFlow's own join call).
  const code = normalizeInviteCode(rawCode);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 5o: a real preview before the auth wall, not a bare redirect — the group's name/avatar/
    // member count only (get_invite_code_preview is deliberately narrower than the design's own
    // mock, which also shows real market questions; see that function's migration comment on
    // why market content stays member-only even here). A wrong/expired code just falls through
    // to the ordinary login redirect below, same as before — this function returns no rows
    // rather than raising for that case (see get_group_by_invite_code's own not_found handling
    // below for why zero rows beats an error for a guessable, low-stakes lookup).
    const anonSupabase = await createAnonClientWithVisitorIp();
    const { data: preview } = (await anonSupabase.rpc('get_invite_code_preview', { p_invite_code: code }).maybeSingle()) as {
      data: { group_name: string; avatar_key: string | null; member_count: number; created_at?: string | null } | null;
    };
    if (preview) {
      return (
        <main className="flex min-h-dvh flex-col bg-canvas">
          <SignedOutInvitePreview
            code={code}
            joinSource={joinSource}
            groupName={preview.group_name}
            groupAvatarKey={preview.avatar_key}
            memberCount={preview.member_count}
            createdAt={preview.created_at ?? null}
          />
        </main>
      );
    }
    redirect(`/login?mode=signup&next=${encodeURIComponent(inviteJoinPath(code, joinSource))}`);
  }

  const { data: group, error } = (await supabase.rpc('get_group_by_invite_code', { p_invite_code: code }).maybeSingle()) as {
    data: { id: string; name: string; avatar_key: string | null; accepting_members: boolean; my_status: string | null } | null;
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
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <InvalidInviteModal
          title={`${friendlyMessage(actionError)}.`}
          body="Codes are limited to a few tries at a time, so nobody can guess their way into a group."
        />
      </main>
    );
  }

  if (!group) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
        <InvalidInviteModal />
      </main>
    );
  }

  const blockedReason =
    group.my_status === 'removed' ? 'removed' : group.my_status === null && !group.accepting_members ? 'not_accepting' : null;

  // 5d's "Pick a face" step edits the same account-level avatar AvatarPicker already owns
  // (see components/groups/JoinFlow.tsx's own note on why this stayed account-level, not
  // per-group). 5e's counts and faces come from get_invite_details, which never returns market
  // content (see its migration).
  const [{ data: profile }, { data: detailsRow }] = await Promise.all([
    supabase.from('users').select('avatar_preset_key, avatar_updated_at').eq('id', user.id).single(),
    supabase.rpc('get_invite_details', { p_invite_code: code }).maybeSingle() as unknown as Promise<{
      data: {
        member_count: number;
        open_count: number;
        settled_count: number;
        created_at: string;
        opening_balance: number | null;
        resolution_window_hours: number;
        faces: InviteFace[];
      } | null;
    }>,
  ]);
  const details = {
    memberCount: detailsRow?.member_count ?? 0,
    openCount: detailsRow?.open_count ?? 0,
    settledCount: detailsRow?.settled_count ?? 0,
    createdAt: detailsRow?.created_at ?? new Date().toISOString(),
    openingBalance: detailsRow?.opening_balance ?? null,
    resolutionWindowHours: Number(detailsRow?.resolution_window_hours ?? 8),
    faces: detailsRow?.faces ?? [],
  };

  // No padding here: each of JoinFlow's screens owns its own gutters and safe-area inset.
  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <JoinFlow
        inviteCode={code}
        joinSource={joinSource}
        groupName={group.name}
        groupAvatarKey={group.avatar_key}
        blockedReason={blockedReason}
        details={details}
        userId={user.id}
        avatarPresetKey={profile?.avatar_preset_key ?? null}
        avatarUpdatedAt={profile?.avatar_updated_at ?? null}
      />
    </main>
  );
}
