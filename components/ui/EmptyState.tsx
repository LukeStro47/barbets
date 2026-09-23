import { cn } from '@/lib/cn';

export function EmptyState({
  icon = '🍻',
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  /** e.g. a button pointing somewhere more useful, like a sibling tab that actually has something in it. */
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline px-6 py-10 text-center">
      {icon ? <div className="text-3xl">{icon}</div> : null}
      <p className={cn(icon ? 'mt-2' : undefined, 'font-semibold text-muted')}>{title}</p>
      {subtitle && <p className="mt-1 text-sm text-faint">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
