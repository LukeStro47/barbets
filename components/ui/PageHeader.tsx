import Link from 'next/link';
import { CaretLeftIcon } from '@/components/ui/icons';

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  backAction,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Rendered on the same row as the back link, right-aligned — for compact status pills that would otherwise crowd the title onto a narrower line. */
  backAction?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {(backHref || backAction) && (
        <div className="flex items-center justify-between gap-3">
          {/* -ml-1 pulls the caret glyph's own padding back out, so the label still starts on the
              page's left margin instead of sitting indented under the title. */}
          {backHref ? (
            <Link href={backHref} className="-ml-1 inline-flex items-center gap-0.5 text-[12.5px] font-bold text-espresso-400 hover:text-espresso-600">
              <CaretLeftIcon className="h-4 w-4 text-espresso-300" />
              {backLabel ?? 'Back'}
            </Link>
          ) : (
            <span />
          )}
          {backAction}
        </div>
      )}
      {/* Baseline, not top: `action` is always a short status line sat beside the title (the
          leaderboard's season/day), and top-aligning small text against a 26px display size
          leaves it floating above the word it belongs to. */}
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 font-display text-[26px] font-extrabold tracking-[-0.02em] text-espresso-950">{title}</h1>
        {action}
      </div>
      {subtitle && <p className="text-espresso-500">{subtitle}</p>}
    </div>
  );
}
