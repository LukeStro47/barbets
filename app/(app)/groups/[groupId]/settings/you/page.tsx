import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsCard, SectionLabel } from '@/components/ui/SettingsList';
import { NicknameEditor } from '@/components/groups/NicknameEditor';
import { LeaveGroupButton } from '@/components/groups/LeaveGroupButton';
import { ForfeitModeratorButton } from '@/components/groups/ForfeitModeratorButton';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { groupSetupTitle } from '@/lib/groupManage';

export default async function YouInThisGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  const { group, isOwner, isPublic, isModerator, myMembership } = ctx;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 pb-7 pt-[30px]">
      <PageHeader title="You in this group" backHref={`/groups/${groupId}/settings`} backLabel={groupSetupTitle(isOwner)} />

      <section>
        <SectionLabel>Nickname</SectionLabel>
        <SettingsCard>
          <div className="px-4 py-3.5">
            <p className="mb-2 text-xs text-espresso-400">Your nickname is how everyone sees you here.</p>
            {myMembership && <NicknameEditor groupId={groupId} nickname={myMembership.nickname} />}
          </div>
          {isPublic && isModerator && !isOwner && <ForfeitModeratorButton groupId={groupId} groupName={group.name} />}
          {!isOwner && <LeaveGroupButton groupId={groupId} groupName={group.name} />}
        </SettingsCard>
      </section>
    </main>
  );
}
