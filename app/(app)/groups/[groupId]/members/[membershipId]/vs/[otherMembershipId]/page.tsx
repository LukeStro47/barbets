import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Mention } from '@/components/ui/Mention';
import { formatTokens, formatSignedTokens } from '@/lib/formatNumber';

interface MemberStats {
  membership_id: string;
  group_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  net: number;
  accuracy_pct: number | null;
  tokens_wagered: number;
}

interface HeadToHeadMarket {
  market_id: string;
  title: string;
  resolved_at: string;
  a_amount: number;
  a_payout: number;
  a_choice: string;
  b_amount: number;
  b_payout: number;
  b_choice: string;
}

/** A compact two-column stat card, reused for both sides of the comparison. */
function StatColumn({ stats, avatarUpdatedAt }: { stats: MemberStats; avatarUpdatedAt: string | null }) {
  const net = Number(stats.net);
  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center gap-2">
        <UserAvatar
          userId={stats.user_id}
          nickname={stats.nickname}
          avatarUpdatedAt={avatarUpdatedAt}
          className="h-9 w-9 text-xs"
          fallbackClassName="bg-espresso-50 text-honey-700"
        />
        <Mention nickname={stats.nickname} className="min-w-0 truncate font-display text-sm font-extrabold text-espresso-950" />
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-espresso-400">Tokens</span>
          <span className="font-bold tabular-nums text-espresso-900">{formatTokens(stats.balance)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-espresso-400">Accuracy</span>
          <span className="font-bold tabular-nums text-espresso-900">{stats.accuracy_pct == null ? '—' : `${stats.accuracy_pct}%`}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-espresso-400">Net</span>
          <span className={`font-bold tabular-nums ${net >= 0 ? 'text-honey-600' : 'text-espresso-400'}`}>{formatSignedTokens(net)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-espresso-400">Wagered</span>
          <span className="font-bold tabular-nums text-espresso-900">{formatTokens(Number(stats.tokens_wagered))}</span>
        </div>
      </div>
    </div>
  );
}

export default async function HeadToHeadPage({
  params,
}: {
  params: Promise<{ groupId: string; membershipId: string; otherMembershipId: string }>;
}) {
  const { groupId, membershipId, otherMembershipId } = await params;
  const supabase = await createClient();

  const [{ data: aData }, { data: bData }, { data: marketsData }] = await Promise.all([
    supabase.rpc('get_member_stats', { p_membership_id: membershipId }),
    supabase.rpc('get_member_stats', { p_membership_id: otherMembershipId }),
    supabase.rpc('get_head_to_head_markets', { p_membership_id_a: membershipId, p_membership_id_b: otherMembershipId }),
  ]);

  const a = notFoundIfEmpty<MemberStats>(aData);
  const b = notFoundIfEmpty<MemberStats>(bData);
  if (a.group_id !== groupId || b.group_id !== groupId) notFound();

  const markets = (marketsData ?? []) as HeadToHeadMarket[];

  const [{ data: aAvatar }, { data: bAvatar }] = await Promise.all([
    supabase.from('users').select('avatar_updated_at').eq('id', a.user_id).single(),
    supabase.from('users').select('avatar_updated_at').eq('id', b.user_id).single(),
  ]);

  return (
    <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
      <PageHeader title="Head to head" backHref={`/groups/${groupId}/members/${membershipId}`} backLabel="Back" />

      <Card>
        <div className="flex gap-4">
          <StatColumn stats={a} avatarUpdatedAt={aAvatar?.avatar_updated_at ?? null} />
          <div className="w-px shrink-0 bg-espresso-100" />
          <StatColumn stats={b} avatarUpdatedAt={bAvatar?.avatar_updated_at ?? null} />
        </div>
      </Card>

      <div>
        <p className="mb-2 ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">Markets you&apos;ve both bet on</p>
        {markets.length === 0 ? (
          <EmptyState icon="🤝" title="No shared markets yet" subtitle="Once you've both bet on the same market, it shows up here." />
        ) : (
          <div className="space-y-2">
            {markets.map((m) => {
              const aWon = m.a_payout > m.a_amount;
              const bWon = m.b_payout > m.b_amount;
              return (
                <Card key={m.market_id} className="space-y-2.5">
                  <p className="truncate text-sm font-bold text-espresso-900">{m.title}</p>
                  <div className="flex gap-4 text-[13px]">
                    <div className="flex-1 space-y-0.5">
                      <p className="truncate text-espresso-500">{m.a_choice}</p>
                      <p className={`font-bold tabular-nums ${aWon ? 'text-honey-600' : 'text-espresso-400'}`}>
                        {formatSignedTokens(Number(m.a_payout) - Number(m.a_amount))}
                      </p>
                    </div>
                    <div className="w-px shrink-0 bg-espresso-100" />
                    <div className="flex-1 space-y-0.5">
                      <p className="truncate text-espresso-500">{m.b_choice}</p>
                      <p className={`font-bold tabular-nums ${bWon ? 'text-honey-600' : 'text-espresso-400'}`}>
                        {formatSignedTokens(Number(m.b_payout) - Number(m.b_amount))}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
