import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import {
  EditSettingsForm,
  RegenerateCodeButton,
  RemoveMemberButton,
  EndSeasonButton,
  TransferOwnershipForm,
  DeleteGroupButton,
} from '@/components/groups/SettingsActions';
import { CopyInviteLink } from '@/components/groups/CopyInviteLink';
import { NicknameEditor } from '@/components/groups/NicknameEditor';
import { LeaveGroupButton } from '@/components/groups/LeaveGroupButton';
import { Mention } from '@/components/ui/Mention';
import type { GroupSettings } from '@/lib/actions/groups';

export default async function GroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase.from('groups').select('id, name, invite_code, owner_id').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = group!.owner_id === user?.id;

  const [{ data: settings }, { data: members }, { data: myMembership }, { data: activeSeason }] = await Promise.all([
    supabase.from('group_settings').select('*').eq('group_id', groupId).single(),
    supabase.from('memberships').select('user_id, status, nickname').eq('group_id', groupId).neq('status', 'removed'),
    supabase.from('memberships').select('nickname').eq('group_id', groupId).eq('user_id', user!.id).single(),
    supabase.from('seasons').select('id').eq('group_id', groupId).eq('status', 'active').single(),
  ]);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Group settings" backHref={`/groups/${groupId}`} backLabel={group!.name} />

      <Card className="space-y-2">
        <h2 className="font-semibold text-espresso-800">Your nickname</h2>
        {myMembership && <NicknameEditor groupId={groupId} nickname={myMembership.nickname} />}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold text-espresso-800">Invite code</h2>
        <p className="font-display text-2xl font-bold text-honey-700">{group!.invite_code}</p>
        <CopyInviteLink inviteCode={group!.invite_code} />
        {isOwner && (
          <>
            <RegenerateCodeButton groupId={groupId} />
            <p className="text-xs text-espresso-400">This code rotates automatically whenever you remove a member.</p>
          </>
        )}
        {!isOwner && settings && !(settings as GroupSettings).accepting_members && (
          <p className="text-xs font-semibold text-espresso-500">This group isn't accepting new members right now.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-espresso-800">Members</h2>
        <ul className="space-y-2">
          {(members ?? []).map((m: any) => (
            <li key={m.user_id} className="flex items-center justify-between">
              <span className="text-espresso-700">
                <Mention nickname={m.nickname} /> {m.status === 'dormant' && <span className="text-xs text-espresso-400">(dormant)</span>}
              </span>
              {isOwner && m.user_id !== group!.owner_id && (
                <RemoveMemberButton groupId={groupId} userId={m.user_id} nickname={m.nickname ?? ''} />
              )}
            </li>
          ))}
        </ul>
      </Card>

      {isOwner && (
        <Card>
          <h2 className="mb-3 font-semibold text-espresso-800">Betting & token settings</h2>
          <EditSettingsForm groupId={groupId} settings={settings as GroupSettings} />
        </Card>
      )}

      {isOwner && activeSeason && (
        <Card>
          <h2 className="mb-2 font-semibold text-espresso-800">Season controls</h2>
          <p className="mb-3 text-sm text-espresso-500">Voids and refunds any open markets, then opens intermission.</p>
          <EndSeasonButton groupId={groupId} />
        </Card>
      )}

      {isOwner && (
        <Card className="space-y-5">
          <h2 className="font-semibold text-danger-700">Danger zone</h2>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-espresso-800">Transfer ownership</h3>
            <TransferOwnershipForm
              groupId={groupId}
              members={(members ?? [])
                .filter((m) => m.status === 'active' && m.user_id !== group!.owner_id)
                .map((m) => ({ userId: m.user_id, nickname: m.nickname ?? '' }))}
            />
          </div>

          <div className="space-y-2 border-t border-espresso-100 pt-4">
            <h3 className="text-sm font-semibold text-espresso-800">Delete group</h3>
            <DeleteGroupButton groupId={groupId} groupName={group!.name} />
          </div>
        </Card>
      )}

      {!isOwner && (
        <Card>
          <h2 className="mb-3 font-semibold text-danger-700">Danger zone</h2>
          <LeaveGroupButton groupId={groupId} groupName={group!.name} />
        </Card>
      )}
    </main>
  );
}
