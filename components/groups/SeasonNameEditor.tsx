'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameSeason } from '@/lib/actions/seasons';

/** Inline owner-only rename control, reused on the group hub (naming the currently active season) and the intermission page (naming the one that's about to start). Blank clears back to the "Season N" fallback. */
export function SeasonNameEditor({
  groupId,
  seasonId,
  currentName,
  className,
}: {
  groupId: string;
  seasonId: string;
  currentName: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className={`text-xs font-medium text-espresso-400 underline decoration-dotted hover:text-espresso-600 ${className ?? ''}`}
      >
        {currentName ? 'Rename season' : 'Name this season'}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {error && <span className="text-xs text-danger-700">{error}</span>}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Friday Game Night"
        maxLength={60}
        className="min-w-0 flex-1 rounded-lg border border-espresso-200 bg-paper-white px-2.5 py-1 text-sm text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await renameSeason(groupId, seasonId, value);
            if (result.error) {
              setError(result.error);
            } else {
              setIsEditing(false);
              router.refresh();
            }
          })
        }
        className="text-xs font-semibold text-honey-700 hover:text-honey-800"
      >
        Save
      </button>
      <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-espresso-400">
        Cancel
      </button>
    </div>
  );
}
