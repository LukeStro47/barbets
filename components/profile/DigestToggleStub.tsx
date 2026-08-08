'use client';

import { Switch } from '@/components/ui/Switch';

/** A results-digest email/push doesn't exist yet (see ARCHITECTURE.md's notification table — only
 * per-event push is real today), so this stays visibly disabled rather than wired to nothing that
 * looks live. Local-only state, never persisted. */
export function DigestToggleStub() {
  return (
    <div className="flex items-center justify-between gap-3.5 py-1">
      <span className="min-w-0">
        <span className="block text-sm font-bold text-espresso-800">Results digest</span>
        <span className="mt-0.5 block text-xs leading-[1.4] text-espresso-400">
          One summary the morning after a group night. Coming soon.
        </span>
      </span>
      <Switch checked={false} onChange={() => {}} disabled className="shrink-0" />
    </div>
  );
}
