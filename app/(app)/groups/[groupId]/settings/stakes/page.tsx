import { notFound } from 'next/navigation';
import { notFoundIfEmpty } from '@/lib/errors';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { groupSetupTitle } from '@/lib/groupManage';
import { StakesEditor } from '@/components/groups/StakesEditor';
import type { GroupSettings } from '@/lib/actions/groups';

export default async function GroupStakesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  if (ctx.isPublic) notFound();
  notFoundIfEmpty(ctx.settings);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-[22px] px-5 pb-7 pt-[30px]">
      <StakesEditor
        groupId={groupId}
        settings={ctx.settings as GroupSettings}
        isPublic={ctx.isPublic}
        canEdit={ctx.isOwner}
        backLabel={groupSetupTitle(ctx.isOwner)}
      />
    </main>
  );
}
