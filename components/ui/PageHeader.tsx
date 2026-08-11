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
            <Link href={backHref} className="-ml-1 inline-flex items-center gap-0.5 text-sm font-medium text-espresso-500 hover:text-espresso-700">
              <CaretLeftIcon className="h-4 w-4" />
              {backLabel ?? 'Back'}
            </Link>
          ) : (
            <span />
          )}
          {backAction}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="min-w-0 font-display text-2xl font-bold tracking-tight text-espresso-900">{title}</h1>
        {action}
      </div>
      {subtitle && <p className="text-espresso-500">{subtitle}</p>}
    </div>
  );
}
