'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { challengeResolution, finalizeMarket } from '@/lib/actions/resolution';
import type { ActionResult } from '@/lib/errors';

/** True once `target` has passed — gates the manual "finalize now" fallback until the real timer would actually let it succeed. */
function useElapsed(target: string | null): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!target) return;
    const check = () => setElapsed(new Date(target).getTime() <= Date.now());
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [target]);
  return elapsed;
}

/**
 * The proposed-outcome screen's one action, meant to sit under the "what happens next" steps
 * that already explain what challenging does.
 *
 * Outlined in danger rather than filled: the expected path through this screen is reading the
 * call and letting the window run out, so a filled button here would ask everyone to treat the
 * exception as the default. It carries no countdown of its own — the stat strip's "Final in"
 * cell is the clock, and two of them on one screen is one too many.
 */
export function ChallengeAction({
  groupId,
  marketId,
  proposedAt,
  resolutionWindowHours,
  iAmProposer,
}: {
  groupId: string;
  marketId: string;
  proposedAt: string;
  resolutionWindowHours: number;
  iAmProposer: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const windowElapsed = useElapsed(new Date(new Date(proposedAt).getTime() + resolutionWindowHours * 3_600_000).toISOString());

  function run(fn: () => Promise<ActionResult<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2.5">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {iAmProposer ? (
        <p className="text-xs text-espresso-400">You proposed this outcome, so you can't challenge it yourself.</p>
      ) : !confirming ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(true)}
          className="w-full rounded-full border border-danger-500 px-4 py-2.5 text-sm font-bold text-danger-700 transition-colors hover:bg-danger-100 disabled:opacity-50"
        >
          Challenge this call
        </button>
      ) : (
        <>
          <p className="text-xs font-semibold text-danger-700">
            This moves the market to a secret ballot for everyone eligible to vote on what actually happened.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-full border border-espresso-200 px-4 py-2.5 text-sm font-semibold text-espresso-800 transition-colors hover:bg-espresso-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => challengeResolution(groupId, marketId))}
              className="flex-1 rounded-full bg-danger-500 px-4 py-2.5 text-sm font-semibold text-paper-white transition-colors hover:bg-danger-700 disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </>
      )}

      {windowElapsed && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => finalizeMarket(groupId, marketId))}
          className="w-full text-center text-xs text-espresso-400 underline"
        >
          Finalize now
        </button>
      )}
    </div>
  );
}
