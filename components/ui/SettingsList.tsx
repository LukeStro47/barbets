import { cn } from '@/lib/cn';
import { ChevronRightIcon } from '@/components/ui/icons';

/**
 * The settings page's "ledger" grammar: labelled sections of hairline-separated rows, where every
 * row carries its value *and* the one sentence saying what that value does to the group.
 *
 * The point of the pattern is that the consequence line is not optional. A settings page that
 * lists "Hedging — Allowed" tells you what the switch is set to and nothing about what it means;
 * the same row with "Members can back more than one side of the same market" underneath is the
 * whole explanation, in the place you would look for it. Rows are separated by a border rather
 * than by margin so a section reads as one document rather than a stack of floating boxes.
 */

/** Uppercase label above a section's card, with an optional right-aligned link or attribution. */
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 px-0.5">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-espresso-400">{children}</p>
      {action}
    </div>
  );
}

/** The card every section's rows live in. Children are separated by a hairline, never by margin. */
export function SettingsCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[14px] border border-espresso-100 bg-paper-white shadow-sm shadow-espresso-900/5',
        '[&>*+*]:border-t [&>*+*]:border-espresso-100',
        className
      )}
    >
      {children}
    </div>
  );
}

/** A read-view setting: label, the consequence line under it, the current value on the right. */
export function SettingRow({
  label,
  consequence,
  value,
}: {
  label: React.ReactNode;
  consequence: React.ReactNode;
  /** A plain string reads as the 14/700 value; pass a node for the pill treatment (see StatusPill). */
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3.5 px-4 py-[13px]">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-espresso-800">{label}</span>
        <span className="mt-0.5 block text-xs leading-[1.45] text-espresso-400">{consequence}</span>
      </span>
      {typeof value === 'string' ? (
        <span className="shrink-0 text-sm font-bold text-espresso-800">{value}</span>
      ) : (
        <span className="shrink-0">{value}</span>
      )}
    </div>
  );
}

/** The one row whose value is a state rather than a figure (Betting), so it reads as a status. */
export function StatusPill({ children, tone = 'dark' }: { children: React.ReactNode; tone?: 'dark' | 'muted' }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-[3px] text-[11.5px] font-bold',
        tone === 'dark' ? 'bg-espresso-800 text-paper-white' : 'bg-espresso-50 text-espresso-600'
      )}
    >
      {children}
    </span>
  );
}

/** Classes for the button/link that wraps `NavRowContent` — a whole row that opens something else. */
export const settingsNavRowClasses =
  'flex w-full items-start justify-between gap-3.5 px-4 py-[13px] text-left transition-colors hover:bg-espresso-50/60';

export function NavRowContent({
  label,
  consequence,
  danger,
}: {
  label: React.ReactNode;
  consequence: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <>
      <span className="min-w-0">
        <span className={cn('block text-sm font-semibold', danger ? 'text-danger-700' : 'text-espresso-800')}>{label}</span>
        <span className="mt-0.5 block text-xs leading-[1.45] text-espresso-400">{consequence}</span>
      </span>
      <ChevronRightIcon className="mt-[3px] h-3.5 w-2 shrink-0 text-espresso-300" />
    </>
  );
}
