import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsCard } from '@/components/ui/SettingsList';
import { MemberSearchBan } from '@/components/groups/MemberSearchBan';
import { MemberRosterList } from '@/components/groups/MemberRosterList';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { groupSetupTitle } from '@/lib/groupManage';
import { createClient } from '@/lib/supabase/server';

export default async function GroupMembersPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  const { group, isOwner, isPublic, canBan, roster, userId } = ctx;

  const supabase = await createClient();
  const { data: avatarRows } = isPublic || roster.length === 0
    ? { data: [] as { id: string; avatar_updated_at: string | null; avatar_preset_key: string | null }[] }
    : await supabase
        .from('users')
        .select('id, avatar_updated_at, avatar_preset_key')
        .in(
          'id',
          roster.map((m) => m.user_id)
        );
  const avatarByUser = new Map((avatarRows ?? []).map((r) => [r.id, r]));

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 pb-7 pt-[30px]">
      <PageHeader
        title="Members"
        backHref={`/groups/${groupId}/settings`}
        backLabel={groupSetupTitle(isOwner)}
        action={!isPublic ? <span className="shrink-0 text-[11.5px] font-extrabold text-faint">{roster.length}</span> : undefined}
      />

      {isPublic ? (
        <MemberSearchBan
          groupId={groupId}
          canBan={canBan}
          members={roster.map((m) => ({
            userId: m.user_id,
            nickname: m.nickname ?? '',
            isOwner: m.user_id === group.owner_id,
            isModerator: m.role === 'moderator',
          }))}
        />
      ) : (
        <SettingsCard>
          <MemberRosterList
            groupId={groupId}
            canRemove={isOwner}
            members={roster.map((m) => {
              const avatar = avatarByUser.get(m.user_id);
              return {
                membershipId: m.id,
                userId: m.user_id,
                nickname: m.nickname ?? '',
                isOwner: m.user_id === group.owner_id,
                isDormant: m.status === 'dormant',
                isYou: m.user_id === userId,
                avatarUpdatedAt: avatar?.avatar_updated_at,
                avatarPresetKey: avatar?.avatar_preset_key,
              };
            })}
          />
        </SettingsCard>
      )}
    </main>
  );
}
