'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameSeason } from '@/lib/actions/seasons';
import { Button } from '@/components/ui/Button';
import { PencilIcon } from '@/components/ui/icons';
import { SEASON_NAME_MAX_LENGTH } from '@/lib/limits';

/** Owner-only season name control, reused on the group settings page (naming the currently active
    season) and the intermission page (naming the one that's about to start). Blank clears back to
    the "Season N" fallback. Owns its own display of the current name rather than relying on a
    sibling label to stay in sync with it — a caller-rendered label next to this component used to
    stay put during editing, so the edit row ended up sharing space with a redundant label *and* an
    inline error message on one un-wrapping flex line, which was what pushed Save/Cancel off the
    edge of the screen on narrow viewports. */
export function SeasonNameEditor({
  groupId,
  seasonId,
  currentName,
  seasonNumber,
  className,
  nameClassName,
}: {
  groupId: string;
  seasonId: string;
  currentName: string | null;
  /** Shown as the "Season N" fallback label when there's no currentName yet. Omit to show just the trigger with no label (e.g. when a page title already displays the name). */
  seasonNumber?: number;
  className?: string;
  /** Styling for the idle-state name span — defaults to the settings-sheet weight; callers
      embedding this in a lighter-weight context (e.g. the group hub's top season line) can match
      their surrounding text instead. */
  nameClassName?: string;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const displayName = currentName ?? (seasonNumber ? `Season ${seasonNumber}` : null);

  if (!isEditing) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
        {displayName && <span className={nameClassName ?? 'text-sm font-semibold text-espresso-800'}>{displayName}</span>}
        <button
          type="button"
          onClick={() => {
            setValue(currentName ?? '');
            setError(null);
            setIsEditing(true);
          }}
          aria-label={currentName ? 'Rename season' : 'Name this season'}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-espresso-400 transition-colors hover:bg-espresso-50 hover:text-espresso-700"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      {error && <p className="text-xs text-danger-700">{error}</p>}
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Friday Game Night"
          maxLength={SEASON_NAME_MAX_LENGTH}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-espresso-200 bg-paper-white px-2.5 py-1.5 text-sm text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
        />
        <Button
          type="button"
          size="sm"
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
        >
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setIsEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
