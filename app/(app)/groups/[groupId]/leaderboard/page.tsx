import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Mention } from '@/components/ui/Mention';
import { formatTokens, formatPercent } from '@/lib/formatNumber';
import { titlesByUser, type GroupTitleRow } from '@/lib/titles';

/** Mirrors The Oracle/Ice Cold's own win-rate definition (see supabase/migrations's
    _recompute_group_titles): correct means the bet's side/option matches what the market
    actually resolved to, not whether it profited — a market can pay out a full refund
    (zero-winner-pool) to someone who still called it right. Same 5-bet floor those titles use,
    so a single lucky or unlucky bet can't put someone at a misleading 100%/0%. */
const MIN_SETTLED_BETS_FOR_ACCURACY = 5;

function medal(rank: number): string {
  return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`;
}

export default async function LeaderboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: settings } = await supabase.from('group_settings').select('seasons_enabled').eq('group_id', groupId).single();

  const { data: activeMembers } = await supabase
    .from('memberships')
    .select('user_id, balance, status, nickname')
    .eq('group_id', groupId)
    .in('status', ['active', 'dormant']);

  // A member who's left only stays on the leaderboard if they actually played — otherwise
  // leaving is clean, with no trace anywhere. "Played" means a real bet, or a non-seed ledger
  // entry (covers e.g. a zero-winner-pool creator/endorser cut with no bet of their own).
  const { data: leftMembers } = await supabase
    .from('memberships')
    .select('id, user_id, balance, status, nickname')
    .eq('group_id', groupId)
    .eq('status', 'left');

  let members: any[] = activeMembers ?? [];
  if (leftMembers && leftMembers.length > 0) {
    const leftUserIds = leftMembers.map((m) => m.user_id);
    const leftMembershipIds = leftMembers.map((m) => m.id);
    const [{ data: leftBetRows }, { data: leftLedgerRows }] = await Promise.all([
      supabase.from('bets').select('user_id, markets!inner(group_id)').eq('markets.group_id', groupId).in('user_id', leftUserIds),
      supabase.from('ledger').select('membership_id').in('membership_id', leftMembershipIds).neq('reason', 'seed'),
    ]);
    const membershipIdToUserId = new Map(leftMembers.map((m) => [m.id, m.user_id]));
    const activeLeftUserIds = new Set([
      ...(leftBetRows ?? []).map((b: any) => b.user_id),
      ...(leftLedgerRows ?? []).map((l: any) => membershipIdToUserId.get(l.membership_id)).filter((id): id is string => !!id),
    ]);
    members = [...members, ...leftMembers.filter((m) => activeLeftUserIds.has(m.user_id))];
  }
  members.sort((a, b) => b.balance - a.balance);

  const { data: titleRows } = await supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId);
  const badges = titlesByUser((titleRows ?? []) as GroupTitleRow[]);

  let allTime: Map<string, number> | null = null;
  if (settings?.seasons_enabled) {
    const { data: ledgerRows } = await supabase
      .from('ledger')
      .select('amount, membership_id, memberships!inner(user_id, group_id)')
      .eq('memberships.group_id', groupId)
      .neq('reason', 'seed');
    allTime = new Map();
    for (const row of ledgerRows ?? ([] as any[])) {
      const userId = (row as any).memberships.user_id;
      allTime.set(userId, (allTime.get(userId) ?? 0) + row.amount);
    }
  }

  // Void markets have no real outcome to be right or wrong about, so they're excluded entirely
  // (never 'resolved' with a null outcome — see ARCHITECTURE.md's status/outcome pairing).
  const { data: settledBetRows } = await supabase
    .from('bets')
    .select('user_id, side, option_id, markets!inner(group_id, status, outcome, outcome_option_id)')
    .eq('markets.group_id', groupId)
    .eq('markets.status', 'resolved');
  const accuracyByUser = new Map<string, { correct: number; total: number }>();
  for (const row of (settledBetRows ?? []) as any[]) {
    const stat = accuracyByUser.get(row.user_id) ?? { correct: 0, total: 0 };
    stat.total += 1;
    const correct = row.option_id ? row.option_id === row.markets.outcome_option_id : row.side === row.markets.outcome;
    if (correct) stat.correct += 1;
    accuracyByUser.set(row.user_id, stat);
  }
  const accuracyRanking = [...accuracyByUser.entries()]
    .filter(([, s]) => s.total >= MIN_SETTLED_BETS_FOR_ACCURACY)
    .map(([userId, s]) => ({ userId, percent: (s.correct / s.total) * 100, total: s.total }))
    .sort((a, b) => b.percent - a.percent || b.total - a.total);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="Leaderboard"
        backHref={`/groups/${groupId}`}
        backLabel="Group"
        action={
          <Link href={`/groups/${groupId}/awards`}>
            <Button size="sm" variant="outline">
              🏆 Awards
            </Button>
          </Link>
        }
      />

      <Card className="space-y-2">
        <h2 className="mb-1 font-display font-bold text-espresso-800">
          {settings?.seasons_enabled ? 'This season' : 'Standings'}
        </h2>
        {(() => {
          const top = members?.[0]?.balance || 1;
          return (members ?? []).map((m: any, i: number) => {
            const isMe = m.user_id === user?.id;
            const pct = Math.max(9, Math.round((m.balance / top) * 100));
            return (
              <div
                key={m.user_id}
                className={`relative h-[54px] overflow-hidden rounded-2xl bg-espresso-50 ${
                  isMe ? 'border-[1.5px] border-honey-500' : 'border-[1.5px] border-transparent'
                }`}
              >
                <span
                  className={`absolute inset-y-0 left-0 ${isMe ? 'bg-honey-500' : 'bg-honey-500/30'}`}
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute inset-0 flex items-center gap-2.5 px-3">
                  <span className="w-5 shrink-0 text-center text-xs font-extrabold text-espresso-500">{medal(i)}</span>
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-white text-xs font-extrabold text-espresso-700 ${
                      isMe ? 'border-2 border-honey-500' : 'border-[1.5px] border-espresso-100'
                    }`}
                  >
                    {m.nickname.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Mention nickname={m.nickname} titles={badges.get(m.user_id)} className="block truncate text-[13.5px] font-bold text-espresso-900" />
                    {(m.balance === 0 || m.status !== 'active') && (
                      <span className="block text-[10.5px] font-semibold text-espresso-400">
                        {m.balance === 0 && 'Broke'}
                        {m.balance === 0 && m.status !== 'active' && ' · '}
                        {m.status === 'dormant' && 'Sitting out'}
                        {m.status === 'left' && 'Left'}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-display text-[15px] font-extrabold tabular-nums text-espresso-900">
                    {formatTokens(m.balance)}
                  </span>
                </span>
              </div>
            );
          });
        })()}
        <p className="pt-1 text-[11.5px] text-espresso-400">Bar length is share of the group's tokens. Your row is outlined.</p>
      </Card>

      {allTime && (
        <Card className="space-y-1">
          <h2 className="mb-2 font-display font-bold text-espresso-800">All-time net</h2>
          {[...allTime.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([userId, net], i) => {
              const m: any = members?.find((x: any) => x.user_id === userId);
              return (
                <div key={userId} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center">{medal(i)}</span>
                    <Mention nickname={m?.nickname ?? ''} titles={badges.get(userId)} className="font-semibold text-espresso-800" />
                  </div>
                  <span className={`font-display font-bold tabular-nums ${net >= 0 ? 'text-honey-600' : 'text-espresso-400'}`}>
                    {net >= 0 ? '+' : ''}
                    {net}
                  </span>
                </div>
              );
            })}
        </Card>
      )}

      {accuracyRanking.length > 0 && (
        <Card className="space-y-1">
          <h2 className="mb-0.5 font-display font-bold text-espresso-800">Accuracy</h2>
          <p className="mb-2 text-xs text-espresso-400">
            How often a bet actually called it right, not how much it won. Min. {MIN_SETTLED_BETS_FOR_ACCURACY} settled bets.
          </p>
          {accuracyRanking.map(({ userId, percent, total }, i) => {
            const m: any = members?.find((x: any) => x.user_id === userId);
            return (
              <div key={userId} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center">{medal(i)}</span>
                  <Mention nickname={m?.nickname ?? ''} titles={badges.get(userId)} className="font-semibold text-espresso-800" />
                </div>
                <span className="text-right">
                  <span className="font-display font-bold tabular-nums text-espresso-900">{formatPercent(percent)}%</span>
                  <span className="ml-1.5 text-xs text-espresso-400">({total})</span>
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </main>
  );
}
