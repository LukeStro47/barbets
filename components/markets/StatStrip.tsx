import type { ReactNode } from 'react';

/** A row of small at-a-glance figures (closes in, the line, bet count, volume) — grouped as one visual "state of the market" zone instead of scattered across other cards. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 overflow-x-auto pb-0.5">{children}</div>;
}

export function StatTile({
  label,
  value,
  accent,
  urgent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  /** Closing soon: a breathing danger-colored border, not the honey accent — honey already means "the line," so reusing it here would blur two different meanings into one color. */
  urgent?: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-4 py-2 text-center ${
        accent ? 'bg-honey-500' : 'bg-espresso-50'
      } ${urgent ? 'animate-urgent-breathe' : ''}`}
    >
      <span className={`text-[10px] font-bold uppercase tracking-wide ${accent ? 'text-espresso-900/60' : 'text-espresso-400'}`}>
        {label}
      </span>
      <span className={`font-display text-lg font-bold leading-tight tabular-nums ${accent ? 'text-espresso-900' : 'text-espresso-800'}`}>
        {value}
      </span>
    </div>
  );
}
