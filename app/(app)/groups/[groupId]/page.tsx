import Link from 'next/link';
import Image from 'next/image';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { getActiveMarkets, getSettledMarkets } from '@/lib/groupFeed';
import { SeasonBanner } from '@/components/groups/SeasonBanner';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { GroupMarketSections } from '@/components/groups/GroupMarketSections';
import { SaveBalanceSnapshot } from '@/components/groups/SaveBalanceSnapshot';
import { PendingBonusPoolNote } from '@/components/groups/PendingBonusPoolNote';
import { OpenSeasonBettingButton } from '@/components/groups/IntermissionActions';
import { WaitingOnYouCard } from '@/components/groups/WaitingOnYouCard';
import { InvitePill } from '@/components/groups/InvitePill';
import { Mention } from '@/components/ui/Mention';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { SettingsIcon, InfoIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/formatNumber';
import { getGroupTasks } from '@/lib/tasks';

// 44px, a real tap target rather than a decorative chip — it's the only control in this header
// now that "My bets" has gone, and it's the way into everything about the group.
const iconLinkClass =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-espresso-50 text-espresso-500 transition-colors hover:bg-espresso-100 hover:text-espresso-700 active:scale-[0.92]';

export default async function GroupFeedPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, avatar_key, invite_code, owner_id, deletion_scheduled_at, pending_bonus_pool')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  const isOwner = group!.owner_id === user?.id;

  // One wave rather than a dozen sequential round trips: none of these depend on each other,
  // and the two feed halves (see lib/groupFeed.ts) each do their own internal batching. Only
  // the season lookup below has to wait, since whether to look for one at all is a setting.
  const [{ data: membership }, { tasks }, { data: settings }, { buckets, pendingTokens }, settledPage] = await Promise.all([
    supabase.from('memberships').select('balance, nickname').eq('group_id', groupId).eq('user_id', user.id).single(),
    getGroupTasks(supabase, groupId, user.id),
    supabase.from('group_settings').select('seasons_enabled, season_length, betting_enabled').eq('group_id', groupId).single(),
    getActiveMarkets(supabase, groupId, user.id),
    getSettledMarkets(supabase, groupId, user.id),
  ]);

  const { data: season } = settings?.seasons_enabled
    ? await supabase
        .from('seasons')
        .select('id, number, status, started_at, ends_at, betting_open, name')
        .eq('group_id', groupId)
        .order('number', { ascending: false })
        .limit(1)
        .single()
    : { data: null };

  return (
    <main className="mx-auto max-w-lg px-5 py-[22px]">
      <SaveBalanceSnapshot groupId={groupId} groupName={group!.name} balance={membership?.balance ?? 0} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Only rendered once the group has actually picked a logo: falling back to the
                initials tile here would put a redundant "TG" chip next to a heading that already
                says the group's name in full. */}
            {group!.avatar_key && (
              <GroupAvatar name={group!.name} avatarKey={group!.avatar_key} className="h-9 w-9" />
            )}
            <h1 className="min-w-0 font-display text-[29px] font-bold tracking-[-0.02em] text-espresso-950">{group!.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/groups/${groupId}/settings`} className={iconLinkClass} aria-label={isOwner ? 'Settings' : 'Group info'}>
              {isOwner ? <SettingsIcon className="h-5 w-5" /> : <InfoIcon className="h-5 w-5" />}
            </Link>
          </div>
        </div>
        {season && season.status !== 'intermission' && (
          <div className="flex items-center gap-2 text-[13px] font-medium text-espresso-400">
            <span>{season.name ?? `Season ${season.number}`}</span>
            {season.ends_at && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-espresso-300" />
                <CountdownTimer target={season.ends_at} prefix="Ends in" />
              </>
            )}
          </div>
        )}
        {season && season.status === 'active' && !season.betting_open && isOwner && (
          <OpenSeasonBettingButton groupId={groupId} seasonId={season.id} />
        )}
      </div>

      <div className="mt-[18px] flex flex-col gap-[18px] pb-10">
        {group!.deletion_scheduled_at && (
          <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
        )}

        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-espresso-900 to-espresso-700 px-5 py-[18px]">
          <Image
            src="/barbets-mono-white.png"
            alt=""
            width={96}
            height={96}
            className="pointer-events-none absolute -top-4 -right-4 rotate-[-10deg] opacity-[0.12]"
          />
          {/* In play sits under the free-to-bet total rather than off to its right: the two are
              the same pile of tokens split in two, so reading down from the headline number to
              "and this much is already committed" tells that story. Side by side they read as
              two unrelated figures competing for the same line. */}
          <div className="relative">
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-honey-400 uppercase">Free to bet</p>
            <p className="mt-0.5 font-display text-[38px] leading-none font-extrabold tracking-[-0.02em] text-paper-white">
              {formatTokens(Math.max(0, (membership?.balance ?? 0) - pendingTokens))}
            </p>
            {pendingTokens > 0 && (
              <p className="mt-2 flex items-baseline gap-1.5 text-[13px] font-semibold text-paper-white/45">
                <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase">In play</span>
                <span className="text-[15px] font-bold text-honey-200">{formatTokens(pendingTokens)}</span>
              </p>
            )}
          </div>
          <div className="relative mt-3.5 flex items-center justify-between border-t border-white/10 pt-3">
            {membership?.nickname && (
              <p className="text-[13px] text-espresso-200">
                Playing as <Mention nickname={membership.nickname} className="text-honey-200" />
              </p>
            )}
            <InvitePill inviteCode={group!.invite_code} />
          </div>
        </div>

        <WaitingOnYouCard groupId={groupId} tasks={tasks} />

        {group!.pending_bonus_pool > 0 && <PendingBonusPoolNote amount={group!.pending_bonus_pool} />}

        {season && <SeasonBanner groupId={groupId} season={{ number: season.number, status: season.status, endsAt: season.ends_at, name: season.name }} />}

        <GroupMarketSections
          groupId={groupId}
          pendingSponsor={buckets.pending_sponsor}
          open={buckets.open}
          awaitingResolution={buckets.awaiting_resolution}
          challenged={buckets.challenged}
          revealed={settledPage.markets}
          revealedNextCursor={settledPage.nextCursor}
        />
      </div>
    </main>
  );
}
