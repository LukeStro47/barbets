import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Mention } from '@/components/ui/Mention';
import { CompareMemberPicker } from '@/components/groups/CompareMemberPicker';
import { formatTokens, formatSignedTokens } from '@/lib/formatNumber';
import type { MemberProfileData } from '@/lib/memberProfile';

/**
 * The member profile's actual content, with no opinion on what wraps it — the full-page route
 * puts a `PageHeader` above it, the modal route puts `RouteModal`'s own banded header instead.
 * See lib/memberProfile.ts for where `data` comes from.
 */
export function MemberProfileCard({ data }: { data: MemberProfileData }) {
  const { stats, groupId, groupName, standing, badges, others, meMembershipId, isYou, net, sinceLabel, avatarUpdatedAt, avatarPresetKey } =
    data;

  return (
    <>
      <Card className="space-y-4">
        <div className="flex items-center gap-3.5">
          <UserAvatar
            userId={stats.user_id}
            nickname={stats.nickname}
            avatarUpdatedAt={avatarUpdatedAt}
            avatarPresetKey={avatarPresetKey}
            className="h-14 w-14 text-lg"
            fallbackClassName="bg-espresso-50 text-honey-700"
          />
          <div className="min-w-0 flex-1">
            <Mention nickname={stats.nickname} className="block truncate font-display text-lg font-extrabold text-espresso-950" />
            <p className="mt-0.5 truncate text-xs text-espresso-400">
              {groupName} · here since {sinceLabel}
            </p>
          </div>
          {isYou && (
            <Link href={`/profile?group=${groupId}`} className="shrink-0 text-[11.5px] font-bold text-honey-700">
              Your settings ›
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-espresso-100 pt-4">
          <div>
            <p className="font-display text-2xl font-extrabold tabular-nums text-espresso-950">{formatTokens(stats.balance)}</p>
            <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-espresso-400 uppercase">Tokens</p>
          </div>
          <div>
            <p className="font-display text-2xl font-extrabold tabular-nums text-espresso-950">{standing}</p>
            <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-espresso-400 uppercase">Standing</p>
          </div>
          <div>
            <p className="font-display text-2xl font-extrabold tabular-nums text-espresso-950">
              {stats.accuracy_pct == null ? '—' : `${stats.accuracy_pct}%`}
            </p>
            <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-espresso-400 uppercase">Accuracy</p>
          </div>
          <div>
            <p className={`font-display text-2xl font-extrabold tabular-nums ${net >= 0 ? 'text-honey-600' : 'text-espresso-400'}`}>
              {formatSignedTokens(net)}
            </p>
            <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-espresso-400 uppercase">All-time net</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-espresso-100 pt-4 text-sm">
          <div>
            <p className="font-semibold text-espresso-700">Tokens wagered</p>
            <p className="text-espresso-500">{formatTokens(Number(stats.tokens_wagered))} lifetime</p>
          </div>
          <div>
            <p className="font-semibold text-espresso-700">Settled bets</p>
            <p className="text-espresso-500">{stats.settled_bet_count}</p>
          </div>
        </div>

        <div className="border-t border-espresso-100 pt-4">
          <p className="text-[10.5px] font-bold tracking-[0.07em] text-espresso-400 uppercase">Best call</p>
          {stats.best_call_multiple ? (
            <p className="mt-1 text-sm font-bold text-espresso-900">
              {stats.best_call_multiple.toFixed(1)}&times; on &ldquo;{stats.best_call_title}&rdquo;
            </p>
          ) : (
            <p className="mt-1 text-sm text-espresso-400">Nothing settled yet.</p>
          )}
        </div>
      </Card>

      {badges.length > 0 && (
        <Link
          href={`/groups/${groupId}/awards`}
          className="flex items-center justify-between rounded-[14px] border border-espresso-100 bg-paper-white px-4 py-3 text-sm font-semibold text-espresso-700"
        >
          Holds {badges.length} award{badges.length === 1 ? '' : 's'}
          <span className="text-espresso-300">›</span>
        </Link>
      )}

      <CompareMemberPicker groupId={groupId} membershipId={stats.membership_id} others={others} meMembershipId={meMembershipId} />
    </>
  );
}
