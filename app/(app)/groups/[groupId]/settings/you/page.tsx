import { ScreenHeader } from '@/components/ui/Screen';
import { SettingsCard, SectionLabel } from '@/components/ui/SettingsList';
import { NicknameEditor } from '@/components/groups/NicknameEditor';
import { LeaveGroupButton } from '@/components/groups/LeaveGroupButton';
import { ForfeitModeratorButton } from '@/components/groups/ForfeitModeratorButton';
import { loadGroupManageContext } from '@/lib/groupManageLoad';

/** Your name in one group. Reached from Settings, or from You's "Your name in {group}" row
 *  (`?from=profile`, so Back goes back there). A nickname is per group by design. */
export default async function YouInThisGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { groupId } = await params;
  const { from } = await searchParams;
  const ctx = await loadGroupManageContext(groupId);
  const { group, isOwner, isPublic, isModerator, myMembership } = ctx;
  const backHref = from === 'profile' ? `/profile?group=${groupId}` : `/groups/${groupId}/settings`;

  return (
    <>
      <ScreenHeader title={`You in ${group.name}`} href={backHref} />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 pt-5 pb-7">
        <section>
          <SectionLabel>Your name here</SectionLabel>
          <SettingsCard>
            <div className="px-4 py-3.5">
              <p className="mb-2.5 text-[12.5px] leading-[1.45] text-muted text-pretty">
                This is how everyone in {group.name} sees and @mentions you. It only changes here: your other groups keep the name
                they know you by.
              </p>
              {myMembership && <NicknameEditor groupId={groupId} nickname={myMembership.nickname} />}
            </div>
            {isPublic && isModerator && !isOwner && <ForfeitModeratorButton groupId={groupId} groupName={group.name} />}
            {!isOwner && <LeaveGroupButton groupId={groupId} groupName={group.name} />}
          </SettingsCard>
        </section>
      </main>
    </>
  );
}
