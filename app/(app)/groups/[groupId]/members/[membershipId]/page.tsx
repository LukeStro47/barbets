import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Mention } from '@/components/ui/Mention';
import { formatTokens, formatOrdinal, formatSignedTokens } from '@/lib/formatNumber';
import { titlesByUser, type GroupTitleRow } from '@/lib/titles';

interface MemberStats {
  membership_id: string;
  group_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  joined_at: string;
  net: number;
  accuracy_pct: number | null;
  settled_bet_count: number;
  tokens_wagered: number;
  best_call_multiple: number | null;
  best_call_title: string | null;
}

/**
 * A read-only record of another member's stats, one tap from their name on the leaderboard or the
 * awards page. Deliberately a separate route from /profile rather than /profile with a `?member=`
 * param: /profile stays the self-only hub with account settings and notification links, and mixing
 * "my settings" with "someone else's stats" on one page would blur what each screen is for.
 *
 * get_member_stats() is the actual gate (see its migration for the privacy reasoning) — this page
 * just renders what it returns. A raised not_found (hidden, removed, or genuinely nonexistent) and
 * a bad membershipId are both an ordinary notFoundIfEmpty() 404, same as everywhere else.
 */
export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ groupId: string; membershipId: string }>;
}) {
  const { groupId, membershipId } = await params;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data } = await supabase.rpc('get_member_stats', { p_membership_id: membershipId });
  const stats = notFoundIfEmpty<MemberStats>(data);
  if (stats.group_id !== groupId) notFound();

  const [{ data: group }, { data: groupMembers }, { data: titleRows }, { data: avatarRow }] = await Promise.all([
    supabase.from('groups').select('name').eq('id', groupId).single(),
    supabase.from('memberships').select('user_id, balance').eq('group_id', groupId).in('status', ['active', 'dormant']),
    supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId),
    supabase.from('users').select('avatar_updated_at').eq('id', stats.user_id).single(),
  ]);

  // Same rank definition every other page uses: currently-playing members sorted by balance
  // descending. A member who has since gone dormant/left just doesn't have a current rank.
  const ranked = [...(groupMembers ?? [])].sort((a, b) => b.balance - a.balance);
  const rankIndex = ranked.findIndex((m) => m.user_id === stats.user_id);
  const standing = rankIndex >= 0 ? `${formatOrdinal(rankIndex + 1)} of ${ranked.length}` : 'Not currently playing';

  const badges = titlesByUser((titleRows ?? []) as GroupTitleRow[]).get(stats.user_id) ?? [];
  const isYou = stats.user_id === user.id;
  const net = Number(stats.net);
  const sinceLabel = new Date(stats.joined_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
      <PageHeader title="Member record" backHref={`/groups/${groupId}/leaderboard`} backLabel="Leaderboard" />

      <Card className="space-y-4">
        <div className="flex items-center gap-3.5">
          <UserAvatar
            userId={stats.user_id}
            nickname={stats.nickname}
            avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
            className="h-14 w-14 text-lg"
            fallbackClassName="bg-espresso-50 text-honey-700"
          />
          <div className="min-w-0 flex-1">
            <Mention
              nickname={stats.nickname}
              titles={badges}
              className="block truncate font-display text-lg font-extrabold text-espresso-950"
            />
            <p className="mt-0.5 truncate text-xs text-espresso-400">
              {group?.name} · here since {sinceLabel}
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
    </main>
  );
}
