import { notFoundIfEmpty } from '@/lib/errors';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { groupSetupTitle } from '@/lib/groupManage';
import { LiveRulesForm } from '@/components/groups/LiveRulesForm';
import type { GroupSettings } from '@/lib/actions/groups';

export default async function GroupRulesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  notFoundIfEmpty(ctx.settings);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-[22px] px-5 pb-7 pt-[30px]">
      <LiveRulesForm
        groupId={groupId}
        settings={ctx.settings as GroupSettings}
        season={ctx.season}
        activeSeason={ctx.activeSeasonRow}
        isPublic={ctx.isPublic}
        canEdit={ctx.canEditSettings}
        backLabel={groupSetupTitle(ctx.isOwner)}
      />
    </main>
  );
}
