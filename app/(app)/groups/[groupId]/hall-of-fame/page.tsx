import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';

/** "Aug 1, '26" — short enough to sit next to the season number without wrapping. */
function formatSeasonDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}, '${String(d.getFullYear()).slice(2)}`;
}

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
              <Card key={i}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-espresso-800">Season {r.seasons?.number}</h3>
                  <span className="text-xs text-espresso-400">
                    {r.seasons?.started_at && formatSeasonDate(r.seasons.started_at)} –{' '}
                    {r.seasons?.ended_at && formatSeasonDate(r.seasons.ended_at)}
                  </span>
                </div>

                {r.snapshot.champion && (
                  <div className="mt-3.5 flex items-center gap-3.5 rounded-2xl bg-honey-50 px-4 py-3.5">
                    <span className="flex h-12 w-12 shrink-0 -rotate-6 items-center justify-center rounded-full bg-honey-500 text-2xl shadow-[0_8px_16px_-6px_rgba(232,163,61,0.55)]">
                      🏆
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold tracking-[0.1em] text-honey-700 uppercase">Champion</p>
                      <p className="truncate font-display text-lg font-bold text-espresso-900">
                        <Mention nickname={r.snapshot.champion.nickname} />
                      </p>
                      <p className="text-sm font-semibold text-honey-700">{formatTokens(r.snapshot.champion.balance)} tokens</p>
                    </div>
                  </div>
                )}

                {/* Perforated ticket-stub divider, same punch-hole trick RevealTicket uses between
                    its header and odds sections, borrowed here to give the recap a "stub torn off
                    a ticket" feel without pulling in the reveal ticket's full dark styling. */}
                <div className="relative -mx-5 mt-4 border-t-2 border-dashed border-espresso-100">
                  <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
                  <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-4 text-sm">
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
