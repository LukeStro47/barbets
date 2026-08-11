import { cn } from '@/lib/cn';

interface PoolStripCell {
  label: string;
  value: React.ReactNode;
  /** The first cell (Pool) is always the honey-toned "this is money" caption; every other cell defaults to the dim/light pairing. Pass 'honey' to match on a cell that's also money (rare), or 'muted' for the default informational look. */
  tone?: 'honey' | 'muted';
  /** flex-grow for this cell, defaulting to an even split. Only the four-cell (bonus pool)
   * layout uses it, where the labels and figures differ enough in width that equal thirds
   * leave "Closes" wrapping while "Bets" sits in whitespace. */
  flex?: number;
  /** A faint honey wash behind the cell. Reserved for the bonus pool, the one cell whose money
   * came from somewhere other than this market's bettors — it needs to read apart without
   * introducing a second accent colour. */
  highlight?: boolean;
}

/** The dark strip used everywhere a market's pool/bet-count/timing context needs to
 * read as money without competing with the page's one primary action. Reuses the same
 * brown gradient as the group balance card on purpose — "dark = money," consistently. Cells
 * are separated by a dashed perforation rather than a solid rule, echoing a ticket stub.
 *
 * Three cells almost everywhere; an open market carrying a `bonus_pool` is the one case that
 * takes a fourth, which tightens the horizontal padding to fit. A cell whose value is meant to
 * be tappable passes a client component as its `value` (see `ClosesInValue`, `BonusPoolValue`)
 * rather than a handler, which keeps this component renderable from a server component. */
export function PoolStrip({ cells, className }: { cells: PoolStripCell[]; className?: string }) {
  const tight = cells.length > 3;
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-2xl bg-gradient-to-br from-espresso-900 to-espresso-700', className)}>
      {cells.map((cell, i) => (
        <div key={i} className={cn('flex items-center', cell.highlight && 'bg-honey-500/12')} style={{ flex: `${cell.flex ?? 1} 1 0` }}>
          {i > 0 && (
            <div
              className="h-full w-px shrink-0"
              style={{
                backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,.26) 0 4px, transparent 4px 9px)',
              }}
            />
          )}
          <div className={cn('min-w-0 flex-1 py-[11px]', tight ? 'px-3' : 'px-4')}>
            <p
              className={cn(
                'text-[9.5px] font-extrabold tracking-[0.13em] uppercase',
                cell.tone === 'honey' || i === 0 ? 'text-honey-400' : 'text-paper-white/40'
              )}
            >
              {cell.label}
            </p>
            <p
              className={cn(
                'mt-0.5 truncate font-display text-[21px] leading-none font-extrabold tracking-[-0.02em] tabular-nums',
                cell.tone === 'honey' || i === 0 ? 'text-paper-white' : 'text-honey-200'
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
