import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { InviteHeroCard } from '@/components/groups/InviteHeroCard';
import { GroupIdentitySheet } from '@/components/groups/GroupIdentitySheet';
import { YouInGroupSheet } from '@/components/groups/YouInGroupSheet';
import { PrizePunishmentSheet } from '@/components/groups/PrizePunishmentSheet';
import { ScreenHeader, RowChevron } from '@/components/ui/Screen';
import { SettingsCard, ManageNavRow } from '@/components/ui/SettingsList';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { cn } from '@/lib/cn';
import { seasonLabel, groupSettingsSubtitle, membersSubtitle, stakesSubtitle, inviteFooter, groupSetupTitle } from '@/lib/groupManage';
import { loadGroupManageContext } from '@/lib/groupManageLoad';
import type { GroupSettings } from '@/lib/actions/groups';

function MemberStack({ members }: { members: { userId: string; nickname: string; avatarUpdatedAt: string | null; avatarPresetKey: string | null }[] }) {
  if (members.length === 0) return null;
  return (
    <span className="mr-1 flex">
      {members.slice(0, 3).map((m, i) => (
        <UserAvatar
          key={m.userId}
          userId={m.userId}
          nickname={m.nickname}
          avatarUpdatedAt={m.avatarUpdatedAt}
          avatarPresetKey={m.avatarPresetKey}
          className={cn('h-6 w-6 border-[1.5px] border-surface text-[9px]', i > 0 && '-ml-[7px]')}
          fallbackClassName="bg-tile text-muted"
        />
      ))}
    </span>
  );
}

/**
 * 4l (member: "Group setup", read-only) and 4o (owner: "Manage group", with Edit). Identity row,
 * the invite card, one card of front-door rows, How it works, and a line saying who sets what.
 */
export default async function ManageGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const ctx = await loadGroupManageContext(groupId);
  const { group, isOwner, isPublic, isModerator, settings, season, activeSeasonRow, roster, myMembership, roleLabel } = ctx;

  const supabase = await createClient();
  const stackIds = [...roster].sort((a, b) => (a.nickname ?? '').localeCompare(b.nickname ?? '')).slice(0, 3);
  const { data: stackUsers } =
    stackIds.length > 0 && !isPublic
      ? await supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', stackIds.map((m) => m.user_id))
      : { data: [] };
  const stack = stackIds.map((m) => {
    const u = (stackUsers ?? []).find((x) => x.id === m.user_id);
    return { userId: m.user_id, nickname: m.nickname ?? '', avatarUpdatedAt: u?.avatar_updated_at ?? null, avatarPresetKey: u?.avatar_preset_key ?? null };
  });

  const memberCount = roster.length;
  const metaLine = [season ? seasonLabel(season) : null, isOwner || roleLabel ? roleLabel : `${memberCount} in`].filter(Boolean).join(' · ');
  const nickname = myMembership?.nickname ?? '';
  const settingsHref = `/groups/${groupId}/settings`;

  const groupSettingsRow = settings && (
    <ManageNavRow href={`${settingsHref}/rules`} title="Group rules" subtitle={groupSettingsSubtitle(settings, season, isPublic)} />
  );
  const membersRow = (
    <ManageNavRow href={`${settingsHref}/members`} title="Members" subtitle={membersSubtitle(roster)} trailing={!isPublic ? <MemberStack members={stack} /> : undefined} />
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
    <YouInGroupSheet groupId={groupId} groupName={group.name} nickname={nickname} isOwner={isOwner} isPublic={isPublic} isModerator={isModerator} />
  );
  const ownerRow = isOwner && <ManageNavRow href={`${settingsHref}/owner`} title="Owner tools" subtitle="End season, transfer, delete" />;

  return (
    <>
      <ScreenHeader
        title={groupSetupTitle(isOwner)}
        href={`/groups/${groupId}/leaderboard`}
        right={
          isOwner ? (
            <GroupIdentitySheet
              groupId={groupId}
              groupName={group.name}
              avatarKey={group.avatar_key}
              activeSeason={season && activeSeasonRow ? { id: activeSeasonRow.id, name: season.name, number: season.number } : null}
            />
          ) : undefined
        }
      />
      <main className="mx-auto flex max-w-[430px] flex-col px-[18px] pt-[13px] pb-8">
        <div className="flex items-center gap-[13px]">
          <GroupAvatar name={group.name} avatarKey={group.avatar_key} className="h-[52px] w-[52px] text-[16px]" fallbackClassName="bg-ink text-on-ink" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[19px] font-extrabold tracking-[-0.02em] text-ink">{group.name}</span>
            {metaLine && <span className="mt-0.5 block truncate text-[12.5px] text-faint">{metaLine}</span>}
          </span>
        </div>

        {group.deletion_scheduled_at && (
          <div className="mt-[13px]">
            <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group.deletion_scheduled_at} isOwner={isOwner} />
          </div>
        )}

        {!isPublic && settings && (
          <div className="mt-[13px]">
            <InviteHeroCard groupId={groupId} inviteCode={group.invite_code} footer={inviteFooter(settings)} canRegenerate={isOwner} />
          </div>
        )}

        <SettingsCard className="mt-3.5">
          {isOwner ? (
            <>
              {groupSettingsRow}
              {ownerRow}
              {membersRow}
              {stakesRow}
              {youRow}
            </>
          ) : (
            <>
              {groupSettingsRow}
              {membersRow}
              {stakesRow}
              {youRow}
            </>
          )}
        </SettingsCard>

        <Link
          href={`/how-it-works?group=${groupId}`}
          className="mt-3.5 flex items-center gap-[11px] rounded-2xl border border-signal-line bg-signal-wash px-[15px] py-[13px]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-surface">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 11v6M12 7.5h.01" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">How it works</span>
          <RowChevron className="text-faint" />
        </Link>

        <p className="mt-3.5 text-[11.5px] leading-[1.5] text-faint text-pretty">
          {isOwner
            ? 'Rule changes save as you make them and apply to markets opened from now on.'
            : 'Set by the owner. Everything here is read-only for members, rules apply to markets opened from now on.'}
        </p>
      </main>
    </>
  );
}
