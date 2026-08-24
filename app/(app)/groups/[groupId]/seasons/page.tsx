import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { getSettledMarkets } from '@/lib/groupFeed';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { SeasonChips, type SeasonChipOption } from '@/components/groups/SeasonChips';
import { SeasonMarketsLoadMore } from '@/components/groups/SeasonMarketsLoadMore';

function formatSeasonDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`;
}

/**
 * "The season's markets" — the full settled history, scoped by season. One level down from the
 * group hub's two archive rows (SeasonMarketsArchiveCard). markets.season_id already existed;
 * this route is what actually reads it (see lib/groupFeed.ts's getSettledMarkets seasonId param).
 */
export default async function SeasonsArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { groupId } = await params;
  const { season: seasonParam } = await searchParams;
  const supabase = await createClient();

  const { data: group } = await supabase.from('groups').select('id, name').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);

  const [{ data: seasons }, { data: results }] = await Promise.all([
    supabase
      .from('seasons')
      .select('id, number, name, started_at, ended_at')
      .eq('group_id', groupId)
      .eq('status', 'archived')
      .order('number', { ascending: false }),
    supabase.from('season_results').select('season_id, snapshot').eq('group_id', groupId),
  ]);

  const archivedSeasons = seasons ?? [];
  const snapshotBySeasonId = new Map((results ?? []).map((r) => [r.season_id, r.snapshot as { champion?: { nickname: string }; markets_settled?: number }]));

  const latestNumber = archivedSeasons[0]?.number ?? null;
  const requested = seasonParam === 'all' ? 'all' : seasonParam ? Number(seasonParam) : latestNumber;
  const selectedSeason = requested === 'all' ? null : archivedSeasons.find((s) => s.number === requested) ?? archivedSeasons[0] ?? null;
  const selectedValue = selectedSeason ? String(selectedSeason.number) : 'all';

  const chipOptions: SeasonChipOption[] = [
    ...archivedSeasons.map((s) => ({ value: String(s.number), label: s.name ?? `Season ${s.number}` })),
    { value: 'all', label: 'All time' },
  ];

  const settledPage = await getSettledMarkets(supabase, groupId, user.id, null, selectedSeason?.id);

  const otherSeasons = selectedSeason ? archivedSeasons.filter((s) => s.id !== selectedSeason.id) : [];

  const title = selectedSeason ? (selectedSeason.name ?? `Season ${selectedSeason.number}`) : 'All seasons';
  const selectedSnapshot = selectedSeason ? snapshotBySeasonId.get(selectedSeason.id) : null;
  const subtitle = selectedSeason
    ? `${selectedSnapshot?.markets_settled ?? 0} settled in ${title}.${
        selectedSeason.number === latestNumber ? ' Nothing open until the next season starts.' : ''
      }`
    : 'Every settled market across every season.';

  return (
    <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
      <PageHeader
        backHref={`/groups/${groupId}`}
        backLabel={group!.name}
        title="The season's markets"
        subtitle={subtitle}
      />

      {archivedSeasons.length === 0 ? (
        <EmptyState icon="🏁" title="No seasons in the books yet" subtitle="This shows up once a season ends." />
      ) : (
        <>
          <SeasonChips groupId={groupId} options={chipOptions} selected={selectedValue} />

          {selectedSeason && (
            <div className="flex items-center gap-2.5 px-1">
              <h2 className="text-xs font-bold tracking-[0.08em] text-espresso-400 uppercase">
                {selectedSeason.name ?? `Season ${selectedSeason.number}`}
              </h2>
              <span className="h-px flex-1 bg-espresso-100" />
              <span className="shrink-0 text-[11.5px] font-bold whitespace-nowrap text-espresso-400">
                {formatSeasonDate(selectedSeason.started_at)}
                {selectedSeason.ended_at && ` – ${formatSeasonDate(selectedSeason.ended_at)}`}
              </span>
            </div>
          )}

          {settledPage.markets.length === 0 ? (
            <EmptyState icon="🏁" title="Nothing settled here" subtitle="No markets resolved during this season." />
          ) : (
            <SeasonMarketsLoadMore
              groupId={groupId}
              seasonId={selectedSeason?.id}
              initialMarkets={settledPage.markets}
              initialCursor={settledPage.nextCursor}
            />
          )}

          {otherSeasons.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              {otherSeasons.map((s) => {
                const snap = snapshotBySeasonId.get(s.id);
                return (
                  <Link
                    key={s.id}
                    href={`/groups/${groupId}/seasons?season=${s.number}`}
                    className="flex items-center gap-3 rounded-[20px] bg-espresso-50/70 px-4 py-3.5"
                  >
                    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-espresso-100 bg-paper-white text-[17px]">
                      🏆
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-extrabold text-espresso-950">{s.name ?? `Season ${s.number}`}</span>
                      <span className="block text-[11.5px] leading-[1.35] text-espresso-500">
                        {formatSeasonDate(s.started_at)}
                        {s.ended_at && ` – ${formatSeasonDate(s.ended_at)}`} · {snap?.markets_settled ?? 0} settled
                        {snap?.champion && (
                          <>
                            {' · '}
                            <Mention nickname={snap.champion.nickname} /> took it
                          </>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-espresso-200 px-3 py-1.5 text-xs font-bold text-espresso-800">Open</span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
