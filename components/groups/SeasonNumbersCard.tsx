import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

/** Shrinks as the formatted string grows, so a group with a five- or six-figure tokens-wagered
 * total doesn't wrap "104,392" onto two lines inside its tile and throw off the row's height and
 * spacing next to the other two (much shorter) stats. */
function valueSizeClass(formatted: string): string {
  if (formatted.length > 9) return 'text-[13px]';
  if (formatted.length > 6) return 'text-[16px]';
  return 'text-[22px]';
}

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
        {tiles.map((t) => {
          const formatted = formatTokens(t.value);
          return (
            <div key={t.label} className="min-w-0 flex-1 rounded-[18px] border border-espresso-100 bg-paper-white px-2.5 py-3.5">
              <p className={cn('font-display font-extrabold whitespace-nowrap text-espresso-950 tabular-nums', valueSizeClass(formatted))}>
                {formatted}
              </p>
              <p className="mt-0.5 text-[10.5px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">{t.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
