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
    <div className="rounded-2xl border border-dashed border-espresso-200 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-2 font-semibold text-espresso-700">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-espresso-400">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
