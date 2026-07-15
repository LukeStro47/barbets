import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';
import { titlesByUser, type GroupTitleRow } from '@/lib/titles';

function medal(rank: number): string {
  return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`;
}

export default async function LeaderboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: settings } = await supabase.from('group_settings').select('seasons_enabled').eq('group_id', groupId).single();

  const { data: members } = await supabase
    .from('memberships')
    .select('user_id, balance, status, nickname')
    .eq('group_id', groupId)
    .neq('status', 'removed')
    .order('balance', { ascending: false });

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

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="Leaderboard"
        backHref={`/groups/${groupId}`}
        backLabel="Group"
        action={
          <Link href={`/groups/${groupId}/hall-of-fame`}>
            <Button size="sm" variant="outline">
              🏆 Hall of Fame
            </Button>
          </Link>
        }
      />

      <Card className="space-y-1">
        <h2 className="mb-2 font-display font-bold text-espresso-800">
          {settings?.seasons_enabled ? 'This season' : 'Standings'}
        </h2>
        {(members ?? []).map((m: any, i: number) => (
          <div key={m.user_id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <span className="w-6 text-center">{medal(i)}</span>
              <Mention nickname={m.nickname} titles={badges.get(m.user_id)} className="font-semibold text-espresso-800" />
              {m.balance === 0 && <span title="Broke">🏚️</span>}
              {m.status === 'dormant' && <span className="text-xs text-espresso-400">(sitting out)</span>}
            </div>
            <span className="font-display font-bold text-espresso-900">{formatTokens(m.balance)}</span>
          </div>
        ))}
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
                  <span className={`font-display font-bold ${net >= 0 ? 'text-honey-600' : 'text-espresso-400'}`}>
                    {net >= 0 ? '+' : ''}
                    {net}
                  </span>
                </div>
              );
            })}
        </Card>
      )}
    </main>
  );
}
