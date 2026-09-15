import Link from 'next/link';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { InviteHeroCard } from '@/components/groups/InviteHeroCard';
import { GroupIdentitySheet } from '@/components/groups/GroupIdentitySheet';
import { YouInGroupSheet } from '@/components/groups/YouInGroupSheet';
import { PrizePunishmentSheet } from '@/components/groups/PrizePunishmentSheet';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsCard, ManageNavRow } from '@/components/ui/SettingsList';
import { InfoIcon, ChevronRightIcon } from '@/components/ui/icons';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/cn';
import {
  seasonLabel,
  groupSettingsSubtitle,
  membersSubtitle,
  stakesSubtitle,
  inviteFooter,
  groupSetupTitle,
} from '@/lib/groupManage';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import type { GroupSettings } from '@/lib/actions/groups';

const STACK_COLORS = [
  'bg-espresso-900 text-honey-300',
  'bg-espresso-600 text-honey-200',
  'bg-espresso-400 text-paper-white',
];

function MemberStack({ nicknames }: { nicknames: string[] }) {
  if (nicknames.length === 0) return null;
  return (
    <span className="flex">
      {nicknames.slice(0, 3).map((name, i) => (
        <span
          key={`${name}-${i}`}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-paper-white text-[9.5px] font-extrabold',
            STACK_COLORS[i],
            i > 0 && '-ml-[7px]'
          )}
        >
          {initials(name)}
        </span>
      ))}
    </span>
  );
}

function HowItWorksBanner({ groupId }: { groupId: string }) {
  return (
    <Link
      href={`/how-it-works?group=${groupId}`}
      className="flex items-center gap-3 rounded-[14px] border border-honey-300 bg-honey-50 px-4 py-[13px] transition-colors hover:bg-honey-100"
    >
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-honey-500 text-espresso-900">
        <InfoIcon className="h-[17px] w-[17px]" />
      </span>
      <span className="flex-1 text-[13.5px] font-bold text-espresso-900">How it works</span>
      <ChevronRightIcon className="h-[15px] w-[11px] shrink-0 text-espresso-400" />
    </Link>
  );
}

export default async function ManageGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  const {
    group,
    isOwner,
    isPublic,
    isModerator,
    settings,
    season,
    activeSeasonRow,
    roster,
    myMembership,
    roleLabel,
  } = ctx;

  const metaLine = [season ? seasonLabel(season) : null, roleLabel].filter(Boolean).join(' · ');
  const nickname = myMembership?.nickname ?? '';
  const settingsHref = `/groups/${groupId}/settings`;
  const stackedNames = [...roster]
    .map((m) => m.nickname ?? '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const groupSettingsRow = settings && (
    <ManageNavRow
      href={`${settingsHref}/rules`}
      title="Group rules"
      subtitle={groupSettingsSubtitle(settings, season, isPublic)}
      highlight
    />
  );
  const membersRow = (
    <ManageNavRow
      href={`${settingsHref}/members`}
      title="Members"
      subtitle={membersSubtitle(roster)}
      trailing={!isPublic ? <MemberStack nicknames={stackedNames} /> : undefined}
      highlight
    />
  );
  const stakesRow = !isPublic && settings && (
    <PrizePunishmentSheet
      groupId={groupId}
      settings={settings as GroupSettings}
      canEdit={isOwner}
      subtitle={stakesSubtitle(settings.prize_text, settings.punishment_text)}
    />
  );
  const youRow = (
    <YouInGroupSheet
      groupId={groupId}
      groupName={group.name}
      nickname={nickname}
      isOwner={isOwner}
      isPublic={isPublic}
      isModerator={isModerator}
    />
  );
  const ownerRow = isOwner && (
    <ManageNavRow href={`${settingsHref}/owner`} title="Owner tools" subtitle="End season, transfer, delete" highlight />
  );

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 pb-7 pt-[30px]">
      <PageHeader
        title={groupSetupTitle(isOwner)}
        subtitle={metaLine || undefined}
        backHref={`/groups/${groupId}`}
        backLabel="Back"
        action={
          isOwner ? (
            <GroupIdentitySheet
              groupId={groupId}
              groupName={group.name}
              avatarKey={group.avatar_key}
              activeSeason={
                season && activeSeasonRow ? { id: activeSeasonRow.id, name: season.name, number: season.number } : null
              }
            />
          ) : undefined
        }
      />

      {group.deletion_scheduled_at && (
        <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group.deletion_scheduled_at} isOwner={isOwner} />
      )}

      {isOwner ? (
        <>
          {!isPublic && settings && (
            <InviteHeroCard
              groupId={groupId}
              groupName={group.name}
              inviteCode={group.invite_code}
              footer={inviteFooter(settings)}
              canRegenerate
            />
          )}
          <SettingsCard>
            {groupSettingsRow}
            {ownerRow}
            {membersRow}
            {stakesRow}
            {youRow}
          </SettingsCard>
        </>
      ) : (
        <>
          {!isPublic && settings && (
            <InviteHeroCard
              groupId={groupId}
              groupName={group.name}
              inviteCode={group.invite_code}
              footer={inviteFooter(settings)}
              canRegenerate={false}
            />
          )}
          <SettingsCard>
            {groupSettingsRow}
            {membersRow}
            {youRow}
            {stakesRow}
          </SettingsCard>
        </>
      )}

      <HowItWorksBanner groupId={groupId} />
    </main>
  );
}
