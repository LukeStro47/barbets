'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameGroup, setGroupAvatar } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { GROUP_AVATARS } from '@/lib/avatars';
import { GROUP_NAME_MAX_LENGTH } from '@/lib/limits';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/cn';

/**
 * The identity row's "Edit" control: the group's name and its logo in one sheet, replacing the two
 * always-open cards that used to sit at the top of the settings page. They're the same decision
 * ("what is this group called and what does it look like"), and neither is edited often enough to
 * earn permanent screen space above the settings that actually govern play.
 *
 * Unlike the old avatar grid, picking a logo here doesn't save on tap — the sheet has one Save, so
 * a tap you didn't mean is undone by Cancel rather than by tapping back to the previous tile.
 */
export function GroupIdentitySheet({
  groupId,
  groupName,
  avatarKey,
}: {
  groupId: string;
  groupName: string;
  avatarKey: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(groupName);
  const [selected, setSelected] = useState<string | null>(avatarKey);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = name.trim();
  const dirty = trimmed !== groupName || selected !== avatarKey;

  function close() {
    setOpen(false);
    setName(groupName);
    setSelected(avatarKey);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      if (trimmed !== groupName) {
        const renamed = await renameGroup(groupId, trimmed);
        if (renamed.error) {
          setError(renamed.error);
          return;
        }
      }
      if (selected !== avatarKey) {
        const avatared = await setGroupAvatar(groupId, selected);
        if (avatared.error) {
          setError(avatared.error);
          return;
        }
      }
      setOpen(false);
      router.refresh();
    });
  }

  const tileClasses = 'flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-[1.5px] transition-colors';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full border border-espresso-200 px-3 py-1.5 text-[12.5px] font-bold text-espresso-800 transition-colors hover:bg-espresso-50"
      >
        Edit
      </button>

      {open && (
        <Modal onClose={close}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Group name and logo</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}

          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-espresso-800" htmlFor="group-identity-name">
              Name
            </label>
            <input
              id="group-identity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={GROUP_NAME_MAX_LENGTH}
              className="w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-semibold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-espresso-800">Logo</p>
            <p className="text-xs leading-[1.45] text-espresso-400">Pick one, or keep the initials.</p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-pressed={selected === null}
                title="Use the group's initials"
                className={cn(
                  tileClasses,
                  'text-[15px] font-extrabold',
                  selected === null ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 bg-paper-white text-espresso-400'
                )}
              >
                {initials(trimmed || groupName)}
              </button>
              {GROUP_AVATARS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setSelected(a.key)}
                  aria-pressed={selected === a.key}
                  title={a.label}
                  className={cn(tileClasses, selected === a.key ? 'border-honey-500 bg-honey-50' : 'border-espresso-200 bg-paper-white')}
                >
                  <img src={`/avatars/${a.key}.png`} alt={a.label} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={close}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={isPending || !dirty || !trimmed} onClick={save}>
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
