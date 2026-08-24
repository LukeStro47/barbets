'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameGroupTitle } from '@/lib/actions/titles';
import { AwardIconPicker } from '@/components/groups/AwardIconPicker';
import { AWARD_LABEL_MAX_LENGTH } from '@/lib/limits';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PencilIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { TitleKey } from '@/lib/titles';

/** Owner-only rename/re-icon control for one of the 4 default titles — same shape as
 *  CustomAwardsSection's create form, just updating an existing fixed title instead of creating a
 *  new row. Dropped onto every card/row a fixed title renders in (AwardsRail, the "held by
 *  others" list, UnclaimedTitles). */
export function EditTitleButton({
  groupId,
  titleKey,
  currentLabel,
  currentIconKey,
  defaultLabel,
  dark = false,
}: {
  groupId: string;
  titleKey: TitleKey;
  currentLabel: string;
  currentIconKey: string;
  defaultLabel: string;
  /** True on AwardsRail's dark gradient cards, where the button needs light-on-dark colors. */
  dark?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(currentLabel);
  const [iconKey, setIconKey] = useState(currentIconKey);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openModal() {
    setLabel(currentLabel);
    setIconKey(currentIconKey);
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await renameGroupTitle(groupId, titleKey, label, iconKey);
      if (result.error) {
        setError(result.error);
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={`Edit ${defaultLabel}`}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
          dark ? 'text-honey-300/80 hover:bg-white/10 hover:text-honey-300' : 'text-espresso-400 hover:bg-espresso-50 hover:text-espresso-700'
        )}
      >
        <PencilIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Edit award</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}

          <label className="block space-y-1.5">
            <span className="block text-xs font-bold text-espresso-500">Name</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={AWARD_LABEL_MAX_LENGTH}
              placeholder={defaultLabel}
              className="w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-semibold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
            />
          </label>

          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-espresso-500">Symbol</span>
            <AwardIconPicker value={iconKey} onChange={setIconKey} />
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={isPending} onClick={submit}>
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
