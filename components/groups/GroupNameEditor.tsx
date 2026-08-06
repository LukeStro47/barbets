'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameGroup } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';

/** Owner-only group rename control, a trimmed SeasonNameEditor — a group always has a name
    (no nullable-with-fallback branch needed, unlike a season's "Season N" default). */
export function GroupNameEditor({ groupId, currentName }: { groupId: string; currentName: string }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isEditing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-espresso-800">{currentName}</span>
        <button
          type="button"
          onClick={() => {
            setValue(currentName);
            setError(null);
            setIsEditing(true);
          }}
          className="text-xs font-medium text-espresso-400 underline decoration-dotted hover:text-espresso-600"
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs text-danger-700">{error}</p>}
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-espresso-200 bg-paper-white px-2.5 py-1.5 text-sm text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
        />
        <Button
          type="button"
          size="sm"
          disabled={isPending || !value.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await renameGroup(groupId, value);
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
