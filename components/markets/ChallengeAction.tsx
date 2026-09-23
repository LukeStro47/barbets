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
 * Outlined in alert rather than filled: the expected path through this screen is reading the
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
      {error && <p className="text-[13.5px] text-alert">{error}</p>}

      {iAmProposer ? (
        <p className="text-[12.5px] text-faint">You proposed this outcome, so you can&apos;t challenge it yourself.</p>
      ) : !confirming ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(true)}
          className="w-full rounded-[14px] border border-alert px-4 py-[13px] text-[15px] font-bold text-alert transition-colors hover:bg-alert-bg disabled:opacity-50"
        >
          Challenge this call
        </button>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-alert-line bg-alert-bg">
          <p className="px-4 pt-3.5 text-[12.5px] leading-[1.45] font-semibold text-alert">
            This moves the market to a secret ballot for everyone eligible to vote on what actually happened.
          </p>
          <div className="flex gap-2 p-3.5 pt-3">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-[14px] border border-hairline bg-surface px-4 py-[11px] text-[15px] font-bold text-ink transition-colors hover:bg-rule"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => challengeResolution(groupId, marketId))}
              className="flex-1 rounded-[14px] bg-ink px-4 py-[11px] text-[15px] font-bold text-white transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {windowElapsed && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => finalizeMarket(groupId, marketId))}
          className="w-full text-center text-[12.5px] font-semibold text-faint underline"
        >
          Finalize now
        </button>
      )}
    </div>
  );
}
