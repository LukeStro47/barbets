import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { formatTokens } from '@/lib/formatNumber';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';

/** "Aug 1, '26" — short enough to sit next to the season number without wrapping. */
function formatSeasonDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}, '${String(d.getFullYear()).slice(2)}`;
}

const SEASON_HISTORY_PAGE_SIZE = 10;

export default async function AwardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { groupId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * SEASON_HISTORY_PAGE_SIZE;
  const to = from + SEASON_HISTORY_PAGE_SIZE; // fetch one extra to know whether a Next page exists

  const [{ data: settings }, { data: titleRows }, { data: members }, { data: resultsPage }] = await Promise.all([
    supabase.from('group_settings').select('seasons_enabled').eq('group_id', groupId).single(),
    supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId),
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).neq('status', 'removed'),
    supabase
      .from('season_results')
      .select('snapshot, seasons(number, started_at, ended_at, name)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .range(from, to),
  ]);

  const { data: activeSeason } = settings?.seasons_enabled
    ? await supabase.from('seasons').select('number, name').eq('group_id', groupId).eq('status', 'active').maybeSingle()
    : { data: null };

  const hasNextPage = (resultsPage ?? []).length > SEASON_HISTORY_PAGE_SIZE;
  const results = (resultsPage ?? []).slice(0, SEASON_HISTORY_PAGE_SIZE);

  const nicknameByUserId = new Map((members ?? []).map((m) => [m.user_id, m.nickname]));
  const rowsByKey = new Map(((titleRows ?? []) as GroupTitleRow[]).map((r) => [r.title_key, r]));

  const heldKeys = TITLE_ORDER.filter((k) => rowsByKey.get(k)?.user_id);
  const vacantKeys = TITLE_ORDER.filter((k) => !rowsByKey.get(k)?.user_id);
  // "Yours" surfaces the first title (in the fixed display order) the viewer currently holds, if
  // any — the hero treatment is a single callout, not a way to show every title someone holds.
  const yourKey = heldKeys.find((k) => rowsByKey.get(k)?.user_id === user?.id);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="Awards"
        subtitle="Who currently holds what, updated as the group plays."
        backHref={`/groups/${groupId}/leaderboard`}
        backLabel="Leaderboard"
        action={
          activeSeason && (
            <span className="shrink-0 rounded-full bg-espresso-100 px-3 py-1 text-xs font-bold text-espresso-700">
              {activeSeason.name ?? `Season ${activeSeason.number}`}
            </span>
          )
        }
      />

      {yourKey && (
        <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 p-[18px] text-paper-white">
          <div className="pointer-events-none absolute inset-0 opacity-55 [background:radial-gradient(circle_at_86%_6%,rgba(232,163,61,0.32),rgba(232,163,61,0)_62%)]" />
          <div className="relative flex items-center gap-3.5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[1.5px] border-honey-300/45 bg-honey-500/16">
              <AwardGlyph titleKey={yourKey} stroke="var(--color-honey-300)" size={27} />
            </span>
            <span className="min-w-0 flex-1">
              <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-honey-400 uppercase">Yours</p>
              <p className="mt-0.5 text-lg font-extrabold tracking-[-0.015em]">{TITLE_META[yourKey].label}</p>
              <p className="mt-0.5 text-[12.5px] leading-[1.45] text-paper-white/60">
                {TITLE_META[yourKey].format(rowsByKey.get(yourKey)!.stat_value)}
              </p>
            </span>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2.5 ml-1 text-[11px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Held right now</h3>
        {heldKeys.length === 0 ? (
          <EmptyState icon="🏆" title="Nobody's earned a title yet" subtitle="Keep playing, they'll start filling in." />
        ) : (
          <div className="space-y-2">
            {heldKeys.map((key) => {
              const meta = TITLE_META[key];
              const row = rowsByKey.get(key)!;
              const isYou = row.user_id === user?.id;
              const nickname = nicknameByUserId.get(row.user_id!) ?? '';
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 rounded-[18px] px-3.5 py-3 ${
                    isYou ? 'border-[1.5px] border-honey-500 bg-honey-500/10' : 'border border-espresso-100 bg-paper-white'
                  }`}
                >
                  <span
                    className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full ${
                      isYou ? 'bg-honey-500' : 'bg-honey-50'
                    }`}
                  >
                    <AwardGlyph titleKey={key} stroke={isYou ? 'var(--color-espresso-900)' : 'var(--color-honey-700)'} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="text-[14px] font-extrabold tracking-[-0.005em] text-espresso-900">{meta.label}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-espresso-400">{meta.description}</p>
                  </span>
                  <span className="shrink-0 text-right">
                    <Mention nickname={nickname} className="block text-[12.5px] font-bold text-espresso-900" />
                    <span className="mt-0.5 block text-[11px] font-extrabold text-honey-700">{meta.format(row.stat_value)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {vacantKeys.length > 0 && (
        <div>
          <h3 className="mb-2.5 ml-1 text-[11px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Up for grabs</h3>
          <div className="space-y-2">
            {vacantKeys.map((key) => {
              const meta = TITLE_META[key];
              return (
                <div key={key} className="flex items-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-espresso-200 px-3.5 py-3">
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-espresso-200">
                    <AwardGlyph titleKey={key} stroke="var(--color-espresso-300)" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="text-[14px] font-extrabold text-espresso-600">{meta.label}</p>
                    <p className="mt-0.5 text-[11.5px] text-espresso-400">{meta.description}</p>
                  </span>
                  <span className="shrink-0 text-[11px] font-bold text-espresso-300">Unclaimed</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The group can't yet propose its own custom awards (see README) — this stays a visible,
          disabled placeholder rather than hidden, so people know it's coming rather than assuming
          the eight above are the whole feature forever. */}
      <div className="flex items-center gap-3 rounded-2xl bg-espresso-50 px-4 py-3.5 opacity-70">
        <span className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold text-espresso-700">Propose an award</p>
          <p className="mt-0.5 text-xs leading-[1.45] text-espresso-400">Coming soon: name your own, group votes it in.</p>
        </span>
        <span className="shrink-0 rounded-full bg-espresso-100 px-2.5 py-1 text-[10.5px] font-bold text-espresso-400">Soon</span>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-espresso-400">Season history</h2>
        {(results ?? []).length === 0 && page === 1 ? (
          <EmptyState icon="🏆" title="No seasons in the books yet" subtitle="History shows up here once a season ends." />
        ) : (
          <div className="space-y-4">
            {(results ?? []).map((r: any, i: number) => (
              <Card key={i}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-espresso-800">{r.seasons?.name ?? `Season ${r.seasons?.number}`}</h3>
                  <span className="text-xs text-espresso-400">
                    {r.seasons?.started_at && formatSeasonDate(r.seasons.started_at)} –{' '}
                    {r.seasons?.ended_at && formatSeasonDate(r.seasons.ended_at)}
                  </span>
                </div>

                {r.snapshot.champion && (
                  <div className="mt-3.5 flex items-center gap-3.5 rounded-2xl bg-honey-50 px-4 py-3.5">
                    <span className="flex h-12 w-12 shrink-0 -rotate-6 items-center justify-center rounded-full border-2 border-honey-500 bg-espresso-900 text-2xl shadow-[0_8px_16px_-6px_rgba(232,163,61,0.55)]">
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

        {(page > 1 || hasNextPage) && (
          <div className="mt-4 flex items-center justify-between text-sm font-semibold">
            {page > 1 ? (
              <Link href={`/groups/${groupId}/awards?page=${page - 1}`} className="text-honey-700 hover:text-honey-800">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            {hasNextPage && (
              <Link href={`/groups/${groupId}/awards?page=${page + 1}`} className="text-honey-700 hover:text-honey-800">
                Older →
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
