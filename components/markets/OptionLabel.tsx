import { cn } from '@/lib/cn';

/** Renders a multiple_choice option label, italicizing and subtly recoloring a leading "@nickname" so a mention reads as a person, not plain text. */
export function OptionLabel({ label, className }: { label: string; className?: string }) {
  if (!label.startsWith('@')) return <>{label}</>;
  return <span className={cn('italic text-honey-700', className)}>{label}</span>;
}
