import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';

export default async function HallOfFamePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const [{ data: titleRows }, { data: members }, { data: results }] = await Promise.all([
    supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId),
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).neq('status', 'removed'),
    supabase
      .from('season_results')
      .select('snapshot, seasons(number, started_at, ended_at)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false }),
  ]);

  const nicknameByUserId = new Map((members ?? []).map((m) => [m.user_id, m.nickname]));
  const rowsByKey = new Map(((titleRows ?? []) as GroupTitleRow[]).map((r) => [r.title_key, r]));

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="Hall of Fame"
        subtitle="Who currently holds what, updated as the group plays."
        backHref={`/groups/${groupId}/leaderboard`}
        backLabel="Leaderboard"
      />

      <div className="space-y-3">
        {TITLE_ORDER.map((key) => {
          const meta = TITLE_META[key];
          const row = rowsByKey.get(key);
          const nickname = row?.user_id ? nicknameByUserId.get(row.user_id) : null;

          return (
            <Card key={key} className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-honey-50 text-2xl">
                {meta.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display font-bold text-espresso-900">{meta.label}</p>
                {nickname ? (
                  <p className="text-sm text-espresso-600">
                    <Mention nickname={nickname} className="font-semibold" />
                    {row?.stat_value != null && ` · ${meta.format(row.stat_value)}`}
                  </p>
                ) : (
                  <p className="text-sm text-espresso-400">Nobody yet</p>
                )}
                <p className="mt-0.5 text-xs text-espresso-400">{meta.description}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-espresso-400">Season history</h2>
        {(results ?? []).length === 0 ? (
          <EmptyState icon="🏆" title="No seasons in the books yet" subtitle="History shows up here once a season ends." />
        ) : (
          <div className="space-y-4">
            {(results ?? []).map((r: any, i: number) => (
              <Card key={i} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-espresso-800">Season {r.seasons?.number}</h3>
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
      </div>
    </main>
  );
}
