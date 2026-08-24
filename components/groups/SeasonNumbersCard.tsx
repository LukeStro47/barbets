import { formatTokens } from '@/lib/formatNumber';

/** Owner-only, from the season_results snapshot's markets_settled/tokens_wagered/bets_placed
 * (see supabase/migrations/20260823140000_season_end_stats_and_title_snapshot.sql). */
export function SeasonNumbersCard({
  marketsSettled,
  tokensWagered,
  betsPlaced,
}: {
  marketsSettled: number;
  tokensWagered: number;
  betsPlaced: number;
}) {
  const tiles = [
    { value: marketsSettled, label: 'markets settled' },
    { value: tokensWagered, label: 'tokens wagered' },
    { value: betsPlaced, label: 'bets placed' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-xs font-bold tracking-[0.08em] text-espresso-400 uppercase">Season in numbers</h2>
      <div className="flex gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="flex-1 rounded-[18px] border border-espresso-100 bg-paper-white px-3 py-3.5">
            <p className="font-display text-[22px] font-extrabold text-espresso-950">{formatTokens(t.value)}</p>
            <p className="mt-0.5 text-[10.5px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">{t.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
