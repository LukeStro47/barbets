import Link from 'next/link';
import { CaretLeftIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * Screen header. When `fixed` is true, matches DESIGN.md shared pattern #2:
 * white bar, hairline bottom, back tile, 15/800 title.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  backAction,
  action,
  fixed = false,
  onBack,
  closeHref,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Rendered on the same row as the back link, right-aligned. */
  backAction?: React.ReactNode;
  action?: React.ReactNode;
  /** Use the fixed ledger header chrome instead of the in-flow page title. */
  fixed?: boolean;
  onBack?: () => void;
  /** Close glyph that dismisses to a parent route (not history back). */
  closeHref?: string;
}) {
  if (fixed) {
    return (
      <header className="fixed inset-x-0 top-0 z-30 border-b border-hairline bg-surface">
        <div className="h-[40px]" aria-hidden />
        <div className="flex items-center gap-[11px] px-[14px] pb-[11px]">
          {(backHref || onBack || closeHref) && (
            backHref || closeHref ? (
              <Link
                href={(closeHref ?? backHref)!}
                aria-label={closeHref ? 'Close' : (backLabel ?? 'Back')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-[#f1f3f7] text-ink"
              >
                {closeHref ? (
                  <span className="text-[18px] leading-none font-medium">×</span>
                ) : (
                  <CaretLeftIcon className="h-4 w-4" />
                )}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onBack}
                aria-label={backLabel ?? 'Back'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-[#f1f3f7] text-ink"
              >
                <CaretLeftIcon className="h-4 w-4" />
              </button>
            )
          )}
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-[-0.015em] text-ink">
            {title}
          </h1>
          {action}
          {backAction}
        </div>
      </header>
    );
  }

  return (
    <div className="space-y-1">
      {(backHref || backAction) && (
        <div className="flex items-center justify-between gap-3">
          {backHref ? (
            <Link
              href={backHref}
              className="-ml-1 inline-flex items-center gap-0.5 text-[12.5px] font-bold text-faint hover:text-muted"
            >
              <CaretLeftIcon className="h-4 w-4 text-faint" />
              {backLabel ?? 'Back'}
            </Link>
          ) : (
            <span />
          )}
          {backAction}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4">
        <h1 className={cn('min-w-0 font-display text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em] text-ink')}>
          {title}
        </h1>
        {action}
      </div>
      {subtitle && <p className="text-[13.5px] leading-[1.5] text-muted">{subtitle}</p>}
    </div>
  );
}
