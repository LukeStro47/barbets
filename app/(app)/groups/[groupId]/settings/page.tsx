import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsCard, SettingRow, SectionLabel } from '@/components/ui/SettingsList';
import { InviteCodeActions, OwnerOnlySection } from '@/components/groups/SettingsActions';
import { MemberSearchBan } from '@/components/groups/MemberSearchBan';
import { MemberRosterList } from '@/components/groups/MemberRosterList';
import { GroupPlaysCard, seasonLabel, type ActiveSeasonSummary } from '@/components/groups/GroupPlaysCard';
import { GroupIdentitySheet } from '@/components/groups/GroupIdentitySheet';
import { SeasonNameEditor } from '@/components/groups/SeasonNameEditor';
import { NicknameEditor } from '@/components/groups/NicknameEditor';
import { LeaveGroupButton } from '@/components/groups/LeaveGroupButton';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { ForfeitModeratorButton } from '@/components/groups/ForfeitModeratorButton';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Mention } from '@/components/ui/Mention';
import { InfoIcon, ChevronRightIcon } from '@/components/ui/icons';
import type { GroupSettings } from '@/lib/actions/groups';

export default async function GroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, avatar_key, invite_code, owner_id, deletion_scheduled_at, is_public')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  const isOwner = group!.owner_id === user?.id;
  const isPublic = group!.is_public;

  const [{ data: settings }, { data: members }, { data: myMembership }, { data: activeSeasonRow }] = await Promise.all([
    supabase.from('group_settings').select('*').eq('group_id', groupId).single(),
    supabase.from('memberships').select('user_id, status, nickname, role').eq('group_id', groupId).in('status', ['active', 'dormant']),
    supabase.from('memberships').select('nickname, role').eq('group_id', groupId).eq('user_id', user.id).single(),
    supabase.from('seasons').select('id, number, name, betting_open').eq('group_id', groupId).eq('status', 'active').single(),
  ]);

  const groupSettings = settings as GroupSettings | null;
  const season: ActiveSeasonSummary | null = activeSeasonRow
    ? { number: activeSeasonRow.number, name: activeSeasonRow.name, bettingOpen: activeSeasonRow.betting_open }
    : null;

  const roster = members ?? [];
  const memberCount = roster.length;
  const ownerNickname = roster.find((m) => m.user_id === group!.owner_id)?.nickname ?? null;
  const isModerator = myMembership?.role === 'moderator';
  const canBan = isOwner || (isPublic && isModerator);
  const canEditSettings = isOwner || (isPublic && isModerator);
  // A light mention rather than a header pill — the settings heading itself takes that spot now.
  const roleLabel = isOwner ? 'Owner' : isModerator ? 'Moderator' : null;
  // Member count used to open this line and, alongside a named season, regularly overflowed it
  // — it's still shown by its own "Members · N" section heading further down, so dropping it
  // here loses nothing.
  const metaLine = [season ? seasonLabel(season) : null, roleLabel].filter(Boolean).join(' · ');

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-[26px] px-5 pb-7 pt-[30px]">
      <PageHeader title="Settings" backHref={`/groups/${groupId}`} backLabel={group!.name} />

      {group!.deletion_scheduled_at && (
        <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
      )}

      {/* Name and logo used to be two always-open cards at the top of this page. They're one
          decision, edited rarely, so they collapse into this row's Edit control instead. */}
      <div className="flex items-center gap-3.5">
        <GroupAvatar
          name={group!.name}
          avatarKey={group!.avatar_key}
          className="h-13 w-13 shrink-0 text-sm"
          fallbackClassName="bg-espresso-900 text-honey-300"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] font-extrabold tracking-[-0.01em] text-espresso-950">{group!.name}</p>
          {/* Owner with an active season gets the same inline pencil-edit affordance the group
              name/logo row does, right here at the top of the page, rather than the name only
              being renameable two taps deep inside "Edit how this group plays" or as a side
              effect of ending the season. */}
          {isOwner && season && activeSeasonRow ? (
            <div className="mt-px flex min-w-0 items-center gap-1 text-[12.5px] text-espresso-400">
              <SeasonNameEditor
                groupId={groupId}
                seasonId={activeSeasonRow.id}
                currentName={season.name}
                seasonNumber={season.number}
                className="min-w-0"
                nameClassName="block min-w-0 truncate text-[12.5px] text-espresso-400"
              />
              {roleLabel && <span className="shrink-0">· {roleLabel}</span>}
            </div>
          ) : (
            <p className="mt-px truncate text-[12.5px] text-espresso-400">{metaLine}</p>
          )}
        </div>
        {isOwner && <GroupIdentitySheet groupId={groupId} groupName={group!.name} avatarKey={group!.avatar_key} />}
      </div>

      <Link
        href={`/how-it-works?group=${groupId}`}
        className="flex items-center gap-3 rounded-[14px] border border-honey-300 bg-honey-50 px-4 py-3.5 transition-colors hover:bg-honey-100"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-honey-500 text-espresso-900">
          <InfoIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-espresso-900">How it works</span>
          <span className="block text-xs text-espresso-500">The house rules, in plain English.</span>
        </span>
        <ChevronRightIcon className="h-[15px] w-[11px] shrink-0 text-espresso-400" />
      </Link>

      {/* No invite code section for a public group — nobody needs one, join_public_group() is
          keyed by group id, not a code (see "Public groups" in ARCHITECTURE.md). */}
      {!isPublic &&
        (isOwner ? (
          <section>
            <SectionLabel>Getting in</SectionLabel>
            <SettingsCard>
              <div className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-espresso-800">Invite code</span>
                  <span className="font-display text-[19px] font-extrabold tracking-[0.06em] text-honey-700">
                    {group!.invite_code}
                  </span>
                </div>
                <InviteCodeActions groupId={groupId} inviteCode={group!.invite_code} canRegenerate />
              </div>
              {groupSettings && (
                <>
                  <SettingRow
                    label="Accepting new members"
                    consequence={groupSettings.accepting_members ? 'Anyone can join with the code' : 'No one can join with the code'}
                    value={groupSettings.accepting_members ? 'Yes' : 'Paused'}
                  />
                  <SettingRow
                    label="Join message"
                    consequence={groupSettings.join_message ? 'Shown when someone joins' : 'Nothing shown when someone joins'}
                    value={groupSettings.join_message ? 'Set' : 'None'}
                  />
                </>
              )}
            </SettingsCard>
          </section>
        ) : (
          <SettingsCard>
            <div className="px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-espresso-800">Invite code</span>
                <span className="font-display text-[19px] font-extrabold tracking-[0.06em] text-honey-700">
                  {group!.invite_code}
                </span>
              </div>
              <InviteCodeActions groupId={groupId} inviteCode={group!.invite_code} canRegenerate={false} />
            </div>
          </SettingsCard>
        ))}

      {groupSettings && (
        <section>
          <SectionLabel
            action={
              canEditSettings ? (
                <Link href={`/how-it-works?group=${groupId}&tab=your-group`} className="text-[11.5px] font-bold text-honey-700">
                  Explain the rules ›
                </Link>
              ) : ownerNickname ? (
                <span className="text-[11px] text-espresso-300">
                  Set by <Mention nickname={ownerNickname} />
                </span>
              ) : (
                <span className="text-[11px] text-espresso-300">Set by the owner</span>
              )
            }
          >
            How this group plays
          </SectionLabel>
          <GroupPlaysCard settings={groupSettings} season={season} isOwner={canEditSettings} isPublic={isPublic} />
          {canEditSettings && (
            <Link
              href={`/groups/${groupId}/settings/edit`}
              className="mt-2.5 block rounded-full border border-espresso-200 px-4 py-[11px] text-center text-sm font-bold text-espresso-800 transition-colors hover:bg-espresso-50"
            >
              Edit how this group plays
            </Link>
          )}
        </section>
      )}

      <section>
        <SectionLabel>Members · {memberCount}</SectionLabel>
        {isPublic ? (
          <MemberSearchBan
            groupId={groupId}
            canBan={canBan}
            members={roster.map((m) => ({
              userId: m.user_id,
              nickname: m.nickname ?? '',
              isOwner: m.user_id === group!.owner_id,
              isModerator: m.role === 'moderator',
            }))}
          />
        ) : (
          <SettingsCard>
            <MemberRosterList
              groupId={groupId}
              canRemove={isOwner}
              members={roster.map((m) => ({
                userId: m.user_id,
                nickname: m.nickname ?? '',
                isOwner: m.user_id === group!.owner_id,
                isDormant: m.status === 'dormant',
                isYou: m.user_id === user?.id,
              }))}
            />
          </SettingsCard>
        )}
      </section>

      <section>
        <SectionLabel>You in this group</SectionLabel>
        <SettingsCard>
          <div className="px-4 py-3.5">
            <p className="mb-2 text-xs text-espresso-400">Your nickname is how everyone sees you here.</p>
            {myMembership && <NicknameEditor groupId={groupId} nickname={myMembership.nickname} />}
          </div>
          {isPublic && isModerator && !isOwner && <ForfeitModeratorButton groupId={groupId} groupName={group!.name} />}
          {!isOwner && <LeaveGroupButton groupId={groupId} groupName={group!.name} />}
        </SettingsCard>
      </section>

      {isOwner && (
        <OwnerOnlySection
          groupId={groupId}
          groupName={group!.name}
          resolutionWindowHours={groupSettings?.resolution_window_hours ?? 8}
          activeSeason={activeSeasonRow ? { id: activeSeasonRow.id, number: activeSeasonRow.number, name: activeSeasonRow.name } : null}
          members={roster
            .filter(
              (m) => m.status === 'active' && m.user_id !== group!.owner_id && (!isPublic || m.role === 'moderator')
            )
            .map((m) => ({ userId: m.user_id, nickname: m.nickname ?? '' }))}
          deletionScheduled={!!group!.deletion_scheduled_at}
          isPublic={isPublic}
        />
      )}
    </main>
  );
}
