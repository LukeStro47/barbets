import { notFound } from 'next/navigation';
import { notFoundIfEmpty } from '@/lib/errors';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import { groupSetupTitle } from '@/lib/groupManage';
import { StakesEditor } from '@/components/groups/StakesEditor';
import type { GroupSettings } from '@/lib/actions/groups';

/** `?from=group` / `?from=leaderboard` sends Back and Save to where the editor was opened. */
export default async function GroupStakesPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { groupId } = await params;
  const { from } = await searchParams;
  const ctx = await loadGroupManageContext(groupId);
  if (ctx.isPublic) notFound();
  notFoundIfEmpty(ctx.settings);

  const back =
    from === 'group'
      ? { href: `/groups/${groupId}`, label: 'Markets' }
      : from === 'leaderboard'
        ? { href: `/groups/${groupId}/leaderboard`, label: 'Leaderboard' }
        : { href: `/groups/${groupId}/settings`, label: groupSetupTitle(ctx.isOwner) };

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-[22px] px-5 pb-7 pt-8">
      <StakesEditor
        groupId={groupId}
        settings={ctx.settings as GroupSettings}
        isPublic={ctx.isPublic}
        canEdit={ctx.isOwner}
        backLabel={back.label}
        backHref={back.href}
      />
    </main>
  );
}
