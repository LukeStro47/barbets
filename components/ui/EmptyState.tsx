export function EmptyState({ icon = '🍻', title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-espresso-200 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-2 font-semibold text-espresso-700">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-espresso-400">{subtitle}</p>}
    </div>
  );
}
