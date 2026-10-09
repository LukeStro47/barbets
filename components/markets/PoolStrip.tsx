import { cn } from '@/lib/cn';

interface PoolStripCell {
  label: string;
  value: React.ReactNode;
  /** The first cell (Pool) is always the signal-toned "this is money" caption; every other cell defaults to the dim/light pairing. Pass 'signal' to match on a cell that's also money (rare), or 'muted' for the default informational look. */
  tone?: 'signal' | 'muted';
  /** flex-grow for this cell, defaulting to an even split. Only the four-cell (bonus pool)
   * layout uses it, where the labels and figures differ enough in width that equal thirds
   * leave "Closes" wrapping while "Bets" sits in whitespace. */
  flex?: number;
  /** A faint signal-blue wash behind the cell. Reserved for the bonus pool, the one cell whose money
   * came from somewhere other than this market's bettors — it needs to read apart without
   * introducing a second accent colour. */
  highlight?: boolean;
}

/** The light stat row used everywhere a market's pool/bet-count/timing context needs to sit
 * right under the title (4d's own Pool/Bets/Closes row) — a bordered white card divided into
 * cells by hairline rules, the same visual language MarketListCard's per-market stat row already
 * uses on the group hub. This used to be a dark "money" strip (reusing the balance card's ink
 * gradient on the reasoning that dark means money, consistently) — the Ledger mockups don't
 * actually carry that convention here; dark ink is reserved for a placed bet's own ticket
 * (the "Your position" card directly below this one), not for market-wide stats. Flattened to
 * match once 4d's actual artboard was read directly rather than assumed from the shared-pattern
 * list.
 *
 * Three cells almost everywhere; an open market carrying a `bonus_pool` is the one case that
 * takes a fourth, which tightens the horizontal padding to fit. A cell whose value is meant to
 * be tappable passes a client component as its `value` (see `ClosesInValue`, `BonusPoolValue`)
 * rather than a handler, which keeps this component renderable from a server component. */
export function PoolStrip({ cells, className }: { cells: PoolStripCell[]; className?: string }) {
  const tight = cells.length > 3;
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-[18px] border border-hairline bg-surface', className)}>
      {cells.map((cell, i) => (
        <div key={i} className={cn('flex items-center', cell.highlight && 'bg-signal-tint')} style={{ flex: `${cell.flex ?? 1} 1 0` }}>
          {i > 0 && <div className="h-full w-px shrink-0 bg-rule" />}
          <div className={cn('min-w-0 flex-1 py-[13px]', tight ? 'px-3' : 'px-[15px]')}>
            <p className="text-[10px] font-bold tracking-[0.1em] text-faint uppercase">{cell.label}</p>
            <p
              className={cn(
                'mt-1 truncate font-mono text-[19px] leading-none font-semibold tabular-nums',
                cell.tone === 'signal' ? 'text-signal' : 'text-ink'
              )}
            >
              {cell.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
