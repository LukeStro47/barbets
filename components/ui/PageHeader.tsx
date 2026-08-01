import Link from 'next/link';

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  backAction,
  action,
}: {
  title: string;
  subtitle?: string;
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
          {backHref ? (
            <Link href={backHref} className="text-sm font-medium text-espresso-500 hover:text-espresso-700">
              ← {backLabel ?? 'Back'}
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
