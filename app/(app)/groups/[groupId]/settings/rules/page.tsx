import { notFoundIfEmpty } from '@/lib/errors';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { LiveRulesForm } from '@/components/groups/LiveRulesForm';
import type { GroupSettings } from '@/lib/actions/groups';

/** 4o2: the live rules, with the owner's end/transfer/delete list at the foot. */
export default async function GroupRulesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  notFoundIfEmpty(ctx.settings);
  const { group, roster, isPublic, isOwner } = ctx;

  return (
    <LiveRulesForm
      groupId={groupId}
      settings={ctx.settings as GroupSettings}
      season={ctx.season}
      activeSeason={ctx.activeSeasonRow}
      isPublic={isPublic}
      canEdit={ctx.canEditSettings}
      ownerTools={
        isOwner
          ? {
              groupName: group.name,
              members: roster
                .filter((m) => m.status === 'active' && m.user_id !== group.owner_id && (!isPublic || m.role === 'moderator'))
                .map((m) => ({ userId: m.user_id, nickname: m.nickname ?? '' })),
              deletionScheduled: !!group.deletion_scheduled_at,
            }
          : null
      }
    />
  );
}
