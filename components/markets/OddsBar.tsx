import { cn } from '@/lib/cn';
import { OptionLabel } from '@/components/markets/OptionLabel';

export interface OddsSide {
  label: string;
  percent: number;
}

/** Split percentage bar: mono figures, signal for the live (takeable) side. */
export function OddsBar({
  left,
  right,
  center,
  className,
}: {
  left: OddsSide;
  right: OddsSide;
  /** over_under only: the line value, wedged between the two sides for context. */
  center?: number | string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2 text-[12.5px] font-semibold">
        <span className="font-mono text-signal">
          {left.label} {left.percent}%
        </span>
        {center !== undefined && (
          <span className="rounded-[10px] border border-signal bg-surface px-2 py-0.5 font-mono text-[12.5px] font-semibold text-signal">
            {center}
          </span>
        )}
        <span className="font-mono text-muted">
          {right.label} {right.percent}%
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-rule">
        <div className="h-full animate-bb-settle bg-signal" style={{ width: `${left.percent}%` }} />
        <div className="h-full animate-bb-settle-b bg-dash" style={{ width: `${right.percent}%` }} />
      </div>
    </div>
  );
}

/** A "nobody wins the color" variant: both sides get identical text weight/color and the
 * bar itself is a single signal scale (fill / tint track) instead of signal-vs-grey — value
 * alone encodes share. Two-tone signal/grey reads as a winner/loser even when it's meant
 * purely as "here's where the money currently sits," so this is what the market-closed and
 * voting screens use instead of the plain OddsBar above. */
export function NeutralOddsBar({
  left,
  right,
  center,
  size = 'sm',
  className,
}: {
  left: OddsSide;
  right: OddsSide;
  center?: React.ReactNode;
  /** 'sm' (10px bar, voting context) or 'lg' (12px bar, final-odds context). */
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className={cn(
          'flex items-baseline justify-between gap-2 font-mono font-semibold text-ink',
          size === 'lg' ? 'text-[15px]' : 'text-[12.5px]'
        )}
      >
        <span className="whitespace-nowrap">
          {left.label} {left.percent}%
        </span>
        {center !== undefined && (
          <span className="shrink-0 rounded-[10px] bg-rule px-2.5 py-0.5 font-sans text-xs font-bold whitespace-nowrap text-muted">
            {center}
          </span>
        )}
        <span className="whitespace-nowrap">
          {right.label} {right.percent}%
        </span>
      </div>
      <div className={cn('flex gap-0.5 overflow-hidden rounded-full', size === 'lg' ? 'h-3' : 'h-2.5')}>
        <div className="h-full animate-bb-settle rounded-full bg-signal" style={{ width: `${left.percent}%` }} />
        <div className="h-full animate-bb-settle-b rounded-full bg-signal-tint" style={{ width: `${right.percent}%` }} />
      </div>
    </div>
  );
}

export interface OddsOption {
  id: string;
  label: string;
  percent: number;
}

/** The multiple_choice generalization of OddsBar: one bar per option, sorted by pool share, highest first. */
export function OddsBarMulti({ options, className }: { options: OddsOption[]; className?: string }) {
  const sorted = [...options].sort((a, b) => b.percent - a.percent);
  return (
    <div className={cn('space-y-2.5', className)}>
      {sorted.map((o, i) => (
        <div key={o.id} className="space-y-1">
          <div className="flex justify-between gap-2 text-[12.5px] font-semibold">
            <span className="min-w-0 flex-1 truncate text-muted">
              <OptionLabel label={o.label} />
            </span>
            <span className="shrink-0 font-mono text-signal">{o.percent}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-rule">
            <div
              className={cn('h-full bg-signal', i % 2 === 0 ? 'animate-bb-settle' : 'animate-bb-settle-b')}
              style={{ width: `${o.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
