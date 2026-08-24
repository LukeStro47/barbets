import Link from 'next/link';
import { cn } from '@/lib/cn';

export interface SeasonChipOption {
  /** A season's `number` (as a string), or the literal 'all' for the all-time chip — numbers
   * rather than ids because the hub page's archive-row link already knows the number and
   * would otherwise need an extra lookup just to link out. */
  value: string;
  label: string;
}

/** Horizontal, non-wrapping season filter row on the /seasons archive route. A plain nav —
 * `selected` comes from the page's own searchParams, so no client state is needed here. */
export function SeasonChips({ groupId, options, selected }: { groupId: string; options: SeasonChipOption[]; selected: string }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {options.map((opt) => (
        <Link
          key={opt.value}
          href={`/groups/${groupId}/seasons?season=${opt.value}`}
          className={cn(
            'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap',
            opt.value === selected ? 'bg-espresso-900 text-honey-300' : 'border border-espresso-200 text-espresso-700'
          )}
        >
          {opt.label}
        </Link>
      ))}
    </div>
  );
}
