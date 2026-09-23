import Link from 'next/link';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Sticky single-CTA footer (DESIGN.md pattern #4). */
export function StickyFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface/95 px-[18px] pt-3 pb-7 backdrop-blur-[8px]',
        className
      )}
    >
      <div className="mx-auto w-full max-w-[430px]">{children}</div>
    </div>
  );
}

/** Mono figure + faint caption cluster. */
export function StatCluster({
  value,
  label,
  className,
  size = 'md',
}: {
  value: ReactNode;
  label: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span
        className={cn(
          'font-mono font-semibold tracking-tight text-ink',
          size === 'lg' && 'text-[42px] leading-none tracking-[-0.03em]',
          size === 'md' && 'text-[15px]',
          size === 'sm' && 'text-[12.5px]'
        )}
      >
        {value}
      </span>
      <span className="mt-[3px] text-[11px] text-faint">{label}</span>
    </div>
  );
}

/** Content scroller with DESIGN gutters and optional header/footer offsets. */
export function ScreenScroller({
  children,
  className,
  tight = false,
  header = false,
  footer = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tight?: boolean;
  header?: boolean;
  footer?: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[430px]',
        tight ? 'px-[18px]' : 'px-[22px]',
        header && 'pt-[var(--header-offset)]',
        footer && 'pb-[var(--sticky-footer-offset)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Settings-style row with hairline border and optional chevron. */
export function Row({
  children,
  className,
  href,
  onClick,
  leading,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ?? (
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden className="shrink-0">
          <path d="M1 1l5 5-5 5" stroke="#8a929f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
  const cls = cn(
    'flex items-center gap-3 rounded-[20px] border border-hairline bg-surface px-4 py-[14px]',
    className
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, 'w-full text-left')}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}
