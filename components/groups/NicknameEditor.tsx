'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateNickname } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white pl-8 pr-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** Settings-page form for changing your own nickname in this group — typos happen. */
export function NicknameEditor({ groupId, nickname }: { groupId: string; nickname: string }) {
  const router = useRouter();
  const [value, setValue] = useState(nickname);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {success && <p className="text-sm text-honey-700">Saved.</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-espresso-400">@</span>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toLowerCase());
              setSuccess(false);
            }}
            maxLength={20}
            className={inputClasses}
          />
        </div>
        <Button
          disabled={isPending || value.trim() === '' || value.trim() === nickname}
          onClick={() =>
            startTransition(async () => {
              const result = await updateNickname(groupId, value.trim());
              if (result.error) {
                setError(result.error);
              } else {
                setError(null);
                setSuccess(true);
                router.refresh();
              }
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
