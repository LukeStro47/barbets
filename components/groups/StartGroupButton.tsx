'use client';

import { PlusIcon } from '@/components/ui/icons';

/** Fired at `window` by any "start a group" affordance outside the bottom nav; BottomNav listens
 * and opens its own create drawer. An event rather than a shared store or a `?new=1` search param
 * because there is exactly one listener, it owns state that nothing else should be able to set
 * directly, and the drawer is not a place worth being able to link to or restore on back. */
export const NEW_GROUP_EVENT = 'barbets:new-group';

/** The groups hub's create button. It opens the same drawer the bottom nav's `+` does rather than
 * navigating straight to /groups/new, so a group is always named and given an allocation in one
 * place — the wizard on the other side is then only ever answering what the drawer didn't. */
export function StartGroupButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(NEW_GROUP_EVENT))}
      className="flex w-full items-center justify-center gap-2 rounded-full border-0 bg-espresso-900 py-3.5 text-[15px] font-extrabold text-paper-white"
    >
      <PlusIcon className="h-4 w-4 text-honey-300" />
      Start a group
    </button>
  );
}
