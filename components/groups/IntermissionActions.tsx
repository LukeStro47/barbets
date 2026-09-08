'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { optInSeason, optOutSeason, cancelSeasonOptout, openSeasonBetting } from '@/lib/actions/seasons';
import { openBetting } from '@/lib/actions/groups';
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
        Opt-Out
      </Button>
    </div>
  );
}

/** Every season starts with betting paused so the owner can see who's actually playing before
 * markets can be created — this is the one action that ends that pause, so it sits right above
 * the market tabs it unblocks rather than tucked into the header next to the season name, where
 * a small button easily read as a minor setting instead of the thing standing between the owner
 * and a working group. */
export function OpenSeasonBettingButton({ groupId, seasonId }: { groupId: string; seasonId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border-[1.5px] border-honey-500 bg-honey-50 px-4 py-3.5">
      <p className="text-sm font-extrabold text-espresso-900">Betting is paused for this season</p>
      <p className="mt-0.5 text-[12.5px] leading-[1.4] text-espresso-500">Nobody can start a market until you open it.</p>
      {error && <p className="mt-2 text-xs text-danger-700">{error}</p>}
      <Button
        variant="accent"
        size="lg"
        className="mt-3 w-full"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await openSeasonBetting(groupId, seasonId);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {isPending ? 'Opening…' : 'Open betting for this season'}
      </Button>
    </div>
  );
}

/** The non-seasonal equivalent of OpenSeasonBettingButton — a brand-new group without seasons
 * starts with betting_enabled off, and turning it on used to be reachable only from the "How this
 * group plays" settings form. Same reasoning as the season version: this is the one action
 * standing between the owner and a working group, so it sits on the hub itself rather than
 * staying a setting most owners never open. Gone the moment betting is on, same as the season
 * button disappearing once betting_open flips. */
export function OpenBettingButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border-[1.5px] border-honey-500 bg-honey-50 px-4 py-3.5">
      <p className="text-sm font-extrabold text-espresso-900">Betting isn't open yet</p>
      <p className="mt-0.5 text-[12.5px] leading-[1.4] text-espresso-500">Nobody can start a market until you open it.</p>
      {error && <p className="mt-2 text-xs text-danger-700">{error}</p>}
      <Button
        variant="accent"
        size="lg"
        className="mt-3 w-full"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await openBetting(groupId);
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {isPending ? 'Opening…' : 'Open betting'}
      </Button>
    </div>
  );
}
