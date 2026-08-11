import { cn } from '@/lib/cn';

/**
 * One beat in a "what this does" list inside a confirmation modal: a coloured dot, the copy, and
 * the connecting rail down to the next dot.
 *
 * The rail is the point. `ResolutionTimeline` already draws the market's lifecycle as dots strung
 * on a line, so a modal that lists the consequences of an action as loose bullets reads as a
 * different kind of thing than the steps it is actually describing. Same grammar, both places.
 *
 * The dot's colour is the ranking, not decoration: danger for what happens to other people
 * immediately, dark for the window they get to react in, faint for the eventual end.
 */
export function ConsequenceRow({
  dotClassName,
  isLast,
  children,
}: {
  dotClassName: string;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center pt-[5px]">
        <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', dotClassName)} />
        {!isLast && <span className="w-[1.5px] flex-1 bg-espresso-100" />}
      </div>
      <p className={cn('text-[13.5px] leading-[1.4] text-espresso-700', !isLast && 'mb-2.5')}>{children}</p>
    </div>
  );
}
