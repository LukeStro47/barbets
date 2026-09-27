'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

/** The design's 7x12 row chevron, stroked faint at 2 — every tappable row ends with it. */
export function RowChevron({ className }: { className?: string }) {
  return (
    <svg width="7" height="12" viewBox="0 0 8 14" fill="none" className={cn('shrink-0', className)} aria-hidden>
      <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

const TILE = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-tile text-ink';

/**
 * The 32px back/close tile on the left of every drill-in header. `href` navigates there; without
 * one, back goes back in history (falling back to `fallbackHref`) and close does the same — the
 * design's "close dismisses to the parent route" is what callers pass as `href`.
 */
export function HeaderTile({
  kind = 'back',
  href,
  fallbackHref = '/groups',
  onClick,
  label,
}: {
  kind?: 'back' | 'close';
  href?: string;
  fallbackHref?: string;
  onClick?: () => void;
  label?: string;
}) {
  const router = useRouter();
  const glyph = kind === 'close' ? <CloseGlyph /> : <BackGlyph />;
  const aria = label ?? (kind === 'close' ? 'Close' : 'Back');
  if (href) {
    return (
      <Link href={href} aria-label={aria} className={TILE}>
        {glyph}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={aria}
      className={TILE}
      onClick={() => {
        if (onClick) return onClick();
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
    >
      {glyph}
    </button>
  );
}

/**
 * The fixed white header every drill-in screen shares (README "shared layout pattern 2"): a
 * hairline at the bottom, the status inset, then a row of back/close tile, title, and an optional
 * right-hand slot. Sticky rather than fixed so it can't collide with PageTransition's transform
 * (sticky survives a transformed ancestor; fixed doesn't) and so the page needs no 104px spacer —
 * the header takes its own room in flow.
 *
 * `tone="context"` is the market-page variant: a 14/700 muted title (the group name) rather than
 * the 15/800 ink screen title, because the market question itself is the page's real headline.
 */
export function ScreenHeader({
  title,
  tile = 'back',
  href,
  fallbackHref,
  onTile,
  right,
  tone = 'title',
  children,
}: {
  title?: ReactNode;
  tile?: 'back' | 'close' | 'none';
  href?: string;
  fallbackHref?: string;
  onTile?: () => void;
  right?: ReactNode;
  tone?: 'title' | 'context';
  /** Rendered under the row, inside the white header (e.g. 4e's Market/Comments tabs). */
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 -mt-[env(safe-area-inset-top)] border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)]">
      <div className="mx-auto flex max-w-[430px] items-center gap-[11px] px-3.5 pb-[11px]">
        {tile !== 'none' && <HeaderTile kind={tile} href={href} fallbackHref={fallbackHref} onClick={onTile} />}
        {typeof title === 'string' ? (
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              tone === 'context' ? 'text-[14px] font-bold text-muted' : 'text-[15px] font-extrabold tracking-[-0.015em] text-ink'
            )}
          >
            {title}
          </span>
        ) : (
          <span className="min-w-0 flex-1">{title}</span>
        )}
        {right}
      </div>
      {children && <div className="mx-auto max-w-[430px]">{children}</div>}
    </header>
  );
}

/**
 * Sticky footer holding exactly one primary action (README pattern 4): 96% white with an 8px
 * blur, a hairline on top, 12px 18px 28px padding. Fixed to the viewport; the page reserves room
 * for it with `pb-[116px]` on its scroller. Sits above BottomNav only on the few screens that
 * show both — drill-in screens hide the nav (lib/navRoute.ts).
 */
export function StickyFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/[0.96] px-[18px] pt-3 pb-[max(28px,env(safe-area-inset-bottom))] backdrop-blur-[8px]',
        className
      )}
    >
      <div className="mx-auto flex max-w-[430px] flex-col gap-[9px]">{children}</div>
    </div>
  );
}

/** The footer CTA: 14px radius, 15px/700, signal with the CTA glow; `tone="ink"` is the dark
 *  variant several screens use for a non-committal "Next"/"Back to the markets". */
export function FooterButton({
  children,
  tone = 'signal',
  disabled,
  onClick,
  type = 'button',
  href,
  form,
}: {
  children: ReactNode;
  tone?: 'signal' | 'ink' | 'outline';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  href?: string;
  form?: string;
}) {
  const cls = cn(
    'block w-full rounded-[14px] py-[15px] text-center text-[15px] font-bold transition-colors',
    disabled
      ? 'bg-disabled-bg text-disabled-ink'
      : tone === 'signal'
        ? 'bg-signal text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] hover:bg-signal-deep'
        : tone === 'ink'
          ? 'bg-ink text-surface'
          : 'border border-hairline bg-surface py-[14px] text-ink'
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} form={form} disabled={disabled} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

/** The uppercase section eyebrow: 10.5px/700, +0.1em, faint. */
export function Eyebrow({ children, className, tone = 'faint' }: { children: ReactNode; className?: string; tone?: 'faint' | 'signal' | 'alert' }) {
  return (
    <p
      className={cn(
        'text-[10.5px] font-bold tracking-[0.1em] uppercase',
        tone === 'signal' ? 'text-signal' : tone === 'alert' ? 'text-alert' : 'text-faint',
        className
      )}
    >
      {children}
    </p>
  );
}

/** A labelled figure cell — the design's recurring 9.5px uppercase label over a mono figure,
 *  separated from its neighbour by a rule. Used in stat strips on 4a, 4d, 5e, 5j, 5k, 5n. */
export function StatCell({
  label,
  value,
  tone = 'ink',
  first,
  flex = 1,
  size = 15,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'ink' | 'signal' | 'gain' | 'alert';
  first?: boolean;
  flex?: number;
  size?: number;
}) {
  return (
    <span className={cn('min-w-0', !first && 'border-l border-rule pl-[13px]')} style={{ flex }}>
      <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</span>
      <span
        className={cn(
          'mt-[3px] block truncate font-mono font-semibold',
          tone === 'signal' ? 'text-signal' : tone === 'gain' ? 'text-gain' : tone === 'alert' ? 'text-alert' : 'text-ink'
        )}
        style={{ fontSize: size }}
      >
        {value}
      </span>
    </span>
  );
}
