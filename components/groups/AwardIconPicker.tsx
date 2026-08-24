'use client';

import { AWARD_ICONS } from '@/lib/awardIcons';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { cn } from '@/lib/cn';

/** The icon-grid picker shared by the custom-award create modal and the default-title edit
 * modal — both awards pick from the same fixed symbol set (lib/awardIcons.ts). */
export function AwardIconPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {AWARD_ICONS.map((icon) => (
        <button
          key={icon.key}
          type="button"
          onClick={() => onChange(icon.key)}
          aria-pressed={value === icon.key}
          title={icon.label}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] transition-colors',
            value === icon.key ? 'border-honey-500 bg-honey-50' : 'border-espresso-200 bg-paper-white'
          )}
        >
          <AwardGlyph iconKey={icon.key} stroke={value === icon.key ? 'var(--color-honey-700)' : 'var(--color-espresso-400)'} />
        </button>
      ))}
    </div>
  );
}
