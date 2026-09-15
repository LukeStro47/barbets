import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { OwnerOnlySection } from '@/components/groups/SettingsActions';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { groupSetupTitle } from '@/lib/groupManage';

export default async function OwnerToolsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  if (!ctx.isOwner) notFound();

  const { group, settings, activeSeasonRow, roster, isPublic } = ctx;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 pb-7 pt-[30px]">
      <PageHeader title="Owner tools" backHref={`/groups/${groupId}/settings`} backLabel={groupSetupTitle(true)} />

      <OwnerOnlySection
        groupId={groupId}
        groupName={group.name}
        resolutionWindowHours={settings?.resolution_window_hours ?? 8}
        activeSeason={activeSeasonRow}
        members={roster
          .filter(
            (m) => m.status === 'active' && m.user_id !== group.owner_id && (!isPublic || m.role === 'moderator')
          )
          .map((m) => ({ userId: m.user_id, nickname: m.nickname ?? '' }))}
        deletionScheduled={!!group.deletion_scheduled_at}
        isPublic={isPublic}
        heading={false}
      />
    </main>
  );
}
