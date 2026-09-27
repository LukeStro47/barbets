import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The "ticket" shell, drawn the way 4h draws its "Your bet" card: a 1.5px edge outline, a wash
 * header band with a 13/800 title on the left and a meta chip or line on the right, and a soft
 * lift. One step above the plain card, reserved for the single card on a market screen that
 * answers "what am I actually deciding here" — the call, what you're vouching for.
 */
export function TicketCard({
  label,
  meta,
  children,
  footer,
  className,
  bodyClassName,
}: {
  label: string;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-[22px] border-[1.5px] border-edge bg-surface shadow-[0_10px_26px_-18px_rgba(12,16,24,0.5)]', className)}>
      <div className="flex items-center justify-between gap-2.5 border-b border-rule bg-wash px-4 py-3">
        <p className="text-[13px] font-extrabold tracking-[-0.01em] text-ink">{label}</p>
        {meta && <div className="shrink-0 text-[12px] font-semibold text-muted">{meta}</div>}
      </div>
      <div className={cn('px-[15px] pt-[13px] pb-[15px]', bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-rule px-4 py-2.5 text-[12px] font-semibold text-faint">{footer}</div>}
    </div>
  );
}
