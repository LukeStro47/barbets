import { cn } from '@/lib/cn';
import { OptionLabel } from '@/components/markets/OptionLabel';

export interface OddsSide {
  label: string;
  percent: number;
}

/** The Polymarket/Kalshi-style split percentage bar, in honey/espresso instead of a trading-terminal palette. */
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
      <div className="flex items-center justify-between text-sm font-semibold">
        <span className="text-honey-800">
          {left.label} {left.percent}%
        </span>
        {center !== undefined && (
          <span className="rounded-full bg-espresso-100 px-2 py-0.5 text-xs font-bold text-espresso-600">{center}</span>
        )}
        <span className="text-espresso-500">
          {right.label} {right.percent}%
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-espresso-100">
        <div className="h-full bg-honey-500" style={{ width: `${left.percent}%` }} />
        <div className="h-full bg-espresso-300" style={{ width: `${right.percent}%` }} />
      </div>
    </div>
  );
}

export interface OddsOption {
  id: string;
  label: string;
  percent: number;
}

/** The multiple_choice generalization of OddsBar: one honey bar per option, sorted by pool share, highest first. */
export function OddsBarMulti({ options, className }: { options: OddsOption[]; className?: string }) {
  const sorted = [...options].sort((a, b) => b.percent - a.percent);
  return (
    <div className={cn('space-y-2.5', className)}>
      {sorted.map((o) => (
        <div key={o.id} className="space-y-1">
          <div className="flex justify-between text-sm font-semibold">
            <span className="text-espresso-700">
              <OptionLabel label={o.label} />
            </span>
            <span className="text-honey-800">{o.percent}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-espresso-100">
            <div className="h-full bg-honey-500" style={{ width: `${o.percent}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
