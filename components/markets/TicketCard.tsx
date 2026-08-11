import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The outlined "ticket" shell: a heavier espresso outline and a tinted header band, one clear
 * step above the plain `Card` used for everything informational. Reserved for the single card
 * on a market screen that answers "what am I actually deciding here" — your position once you
 * have one, otherwise the line / the options / what you're vouching for / the proposed call.
 * Exactly one of these is on screen at a time, which is what makes the outline mean something.
 */
export function TicketCard({
  label,
  meta,
  children,
  footer,
  className,
  bodyClassName,
}: {
  /** Left side of the header band, rendered uppercase. */
  label: string;
  /** Right side of the header band — the market kind, the option count, the proposer. */
  meta?: ReactNode;
  children: ReactNode;
  /** A quiet full-bleed rule under the body ("2 of 9 bets on this market"). Rendered outside the
   * body's padding so its top border spans the whole card rather than insetting. */
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[22px] border-[1.5px] border-espresso-800 bg-paper-white shadow-[0_6px_18px_-12px_rgba(28,19,13,0.35)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[11px]">
        <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">{label}</p>
        {meta && <p className="shrink-0 text-xs font-semibold text-espresso-500">{meta}</p>}
      </div>
      <div className={cn('px-[18px] py-4', bodyClassName)}>{children}</div>
      {footer && (
        <div className="border-t border-espresso-50 px-[18px] py-2.5 text-xs font-semibold text-espresso-400">{footer}</div>
      )}
    </div>
  );
}
