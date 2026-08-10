import { cn } from '@/lib/cn';

interface PoolStripCell {
  label: string;
  value: React.ReactNode;
  /** The first cell (Pool) is always the honey-toned "this is money" caption; every other cell defaults to the dim/light pairing. Pass 'honey' to match on a cell that's also money (rare), or 'muted' for the default informational look. */
  tone?: 'honey' | 'muted';
}

/** The dark 3-cell strip used everywhere a market's pool/bet-count/timing context needs to
 * read as money without competing with the page's one primary action. Reuses the same
 * brown gradient as the group balance card on purpose — "dark = money," consistently. Cells
 * are separated by a dashed perforation rather than a solid rule, echoing a ticket stub. */
export function PoolStrip({ cells, className }: { cells: PoolStripCell[]; className?: string }) {
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-2xl bg-gradient-to-br from-espresso-900 to-espresso-700', className)}>
      {cells.map((cell, i) => (
        <div key={i} className="flex flex-1 items-center">
          {i > 0 && (
            <div
              className="h-full w-px shrink-0"
              style={{
                backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,.26) 0 4px, transparent 4px 9px)',
              }}
            />
          )}
          <div className="min-w-0 flex-1 px-4 py-[11px]">
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
