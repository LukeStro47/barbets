'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { optInSeason, optOutSeason, cancelSeasonOptout, startSeason, openSeasonBetting } from '@/lib/actions/seasons';
import { Button } from '@/components/ui/Button';

/**
 * Two populations, two mechanisms. A currently-active member is included by
 * default and can pre-emptively skip the next season (optOutSeason /
 * cancelSeasonOptout). A currently-dormant member (self-service leave, a
 * prior opt-out, or just joined mid-intermission) stays out unless they ask
 * in (optInSeason, unchanged from before this feature).
 */
export function RosterControl({
  groupId,
  seasonId,
  membershipStatus,
  hasOptedOut,
  hasOptedIn,
}: {
  groupId: string;
  seasonId: string;
  membershipStatus: 'active' | 'dormant';
  hasOptedOut: boolean;
  hasOptedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (membershipStatus === 'dormant') {
    if (hasOptedIn) {
      return (
        <Button variant="outline" disabled className="w-full">
          You're in ✓
        </Button>
      );
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
              if (result.error) setError(result.error);
              else router.refresh();
            })
          }
          className="w-full"
        >
          I'm in
        </Button>
      </div>
    );
  }

  if (hasOptedOut) {
    return (
      <div>
        {error && <p className="mb-2 text-sm text-danger-700">{error}</p>}
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelSeasonOptout(groupId, seasonId);
              if (result.error) setError(result.error);
              else router.refresh();
            })
          }
          className="w-full"
        >
          You're out, back in?
        </Button>
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-danger-700">{error}</p>}
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await optOutSeason(groupId, seasonId);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
        className="w-full"
      >
        You're in, not playing this one?
      </Button>
    </div>
  );
}

export function ContinueButton({ groupId, playingCount }: { groupId: string; playingCount: number }) {
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
        Continue ({playingCount} playing)
      </Button>
    </div>
  );
}

/** Every season starts with betting paused so the owner can see who's actually playing before markets can be created. */
export function OpenSeasonBettingButton({ groupId, seasonId }: { groupId: string; seasonId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      {error && <p className="mb-1 text-xs text-danger-700">{error}</p>}
      <Button
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await openSeasonBetting(groupId, seasonId);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        Open betting for this season
      </Button>
    </div>
  );
}
