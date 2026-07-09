import Link from 'next/link';

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {backHref && (
        <Link href={backHref} className="text-sm font-medium text-espresso-500 hover:text-espresso-700">
          ← {backLabel ?? 'Back'}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <h1 className="min-w-0 font-display text-2xl font-bold tracking-tight text-espresso-900">{title}</h1>
        {action}
      </div>
      {subtitle && <p className="text-espresso-500">{subtitle}</p>}
    </div>
  );
}
