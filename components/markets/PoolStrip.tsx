import { cn } from '@/lib/cn';

export interface PoolStripCell {
  label: string;
  value: React.ReactNode;
  /** The first cell (Pool) is always the signal-toned "this is money" caption; every other cell defaults to the dim/light pairing. Pass 'signal' (or legacy 'honey') for money cells, or 'muted' for informational. */
  tone?: 'signal' | 'honey' | 'muted';
  /** flex-grow for this cell, defaulting to an even split. Only the four-cell (bonus pool)
   * layout uses it, where the labels and figures differ enough in width that equal thirds
   * leave "Closes" wrapping while "Bets" sits in whitespace. */
  flex?: number;
  /** A faint signal wash behind the cell. Reserved for the bonus pool. */
  highlight?: boolean;
}

/** Dark money strip: ink ground, dashed perforations, mono figures. */
export function PoolStrip({ cells, className }: { cells: PoolStripCell[]; className?: string }) {
  const tight = cells.length > 3;
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-[20px] bg-ink', className)}>
      {cells.map((cell, i) => {
        const moneyTone = cell.tone === 'signal' || cell.tone === 'honey' || i === 0;
        return (
          <div key={i} className={cn('flex items-center', cell.highlight && 'bg-signal/12')} style={{ flex: `${cell.flex ?? 1} 1 0` }}>
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
                  moneyTone ? 'text-on-ink' : 'text-white/40'
                )}
              >
                {cell.label}
              </p>
              <p
                className={cn(
                  'mt-0.5 truncate font-mono text-[15px] font-semibold tracking-tight',
                  moneyTone ? 'text-white' : 'text-on-ink'
                )}
              >
                {cell.value}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
