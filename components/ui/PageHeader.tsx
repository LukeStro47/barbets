import Link from 'next/link';

/**
 * The header for screens the mockups don't draw individually (awards, member records, account,
 * notifications, owner tools, admin...). With a back link it becomes the Ledger drill-in header
 * every mocked screen uses — a sticky white bar with a hairline, a 32px back tile and the title
 * at 15/800 — and bleeds out of its page's 20px/32px padding (`-mx-5 -mt-8`) so it spans the
 * screen the way ScreenHeader does. The subtitle drops underneath as a plain line.
 *
 * Without a back link it's a top-level page title (26/800), which is how it began.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backAction,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  /** Kept for older callers; the back tile carries no label. */
  backLabel?: string;
  /** Right-hand content in the header bar (a status pill, an Edit button). */
  backAction?: React.ReactNode;
  action?: React.ReactNode;
}) {
  if (backHref) {
    return (
      <div>
        <header className="sticky top-0 z-40 -mx-5 -mt-8 border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="flex items-center gap-[11px] px-3.5 pb-[11px]">
            <Link
              href={backHref}
              aria-label="Back"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-tile text-ink"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </Link>
            <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-[-0.015em] text-ink">{title}</span>
            {backAction}
            {action}
          </div>
        </header>
        {subtitle && <div className="mt-5 text-[13px] leading-[1.45] text-faint">{subtitle}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em] text-ink">{title}</h1>
        {action}
      </div>
      {subtitle && <p className="text-[13px] leading-[1.4] text-faint">{subtitle}</p>}
    </div>
  );
}
