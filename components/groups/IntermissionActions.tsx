'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { optInSeason, startSeason } from '@/lib/actions/seasons';
import { Button } from '@/components/ui/Button';

export function OptInButton({ groupId, seasonId, alreadyIn }: { groupId: string; seasonId: string; alreadyIn: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (alreadyIn) {
    return <Button variant="outline" disabled className="w-full">
      You're in ✓
    </Button>;
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-danger-700">{error}</p>}
      <Button
        variant="accent"
        size="lg"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await optInSeason(groupId, seasonId);
            if (result.error) {
              setError(result.error);
            } else {
              router.refresh();
            }
          })
        }
        className="w-full"
      >
        I'm in
      </Button>
    </div>
  );
}

export function StartSeasonButton({ groupId, optInCount }: { groupId: string; optInCount: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      {error && <p className="mb-2 text-sm text-danger-700">{error}</p>}
      <Button
        size="lg"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await startSeason(groupId);
            if (result.error) {
              setError(result.error);
            } else {
              router.push(`/groups/${groupId}`);
            }
          })
        }
        className="w-full"
      >
        Start season ({optInCount} in)
      </Button>
    </div>
  );
}
