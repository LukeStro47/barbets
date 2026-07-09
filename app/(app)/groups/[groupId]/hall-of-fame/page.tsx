import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';

export default async function HallOfFamePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: results } = await supabase
    .from('season_results')
    .select('snapshot, seasons(number, started_at, ended_at)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Hall of Fame" backHref={`/groups/${groupId}/leaderboard`} backLabel="Leaderboard" />

      {(results ?? []).length === 0 ? (
        <EmptyState icon="🏆" title="No seasons in the books yet" subtitle="History shows up here once a season ends." />
      ) : (
        <div className="space-y-4">
          {(results ?? []).map((r: any, i: number) => (
            <Card key={i} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-espresso-800">Season {r.seasons?.number}</h2>
                <span className="text-xs text-espresso-400">
                  {r.seasons?.started_at?.slice(0, 10)} – {r.seasons?.ended_at?.slice(0, 10)}
                </span>
              </div>

              {r.snapshot.champion && (
                <div className="rounded-xl bg-honey-50 px-4 py-3 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wide text-honey-700">Champion</p>
                  <p className="font-display text-lg font-bold text-honey-900">
                    🏆 <Mention nickname={r.snapshot.champion.nickname} /> with {formatTokens(r.snapshot.champion.balance)}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                {r.snapshot.biggest_single_win && (
                  <div>
                    <p className="font-semibold text-espresso-700">Biggest win</p>
                    <p className="text-espresso-500">
                      <Mention nickname={r.snapshot.biggest_single_win.nickname} /> +{formatTokens(r.snapshot.biggest_single_win.amount)}
                    </p>
                  </div>
                )}
                {r.snapshot.worst_beat && (
                  <div>
                    <p className="font-semibold text-espresso-700">Worst beat</p>
                    <p className="text-espresso-500">
                      <Mention nickname={r.snapshot.worst_beat.nickname} /> −{formatTokens(r.snapshot.worst_beat.amount)}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
