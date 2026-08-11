'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sponsorMarket } from '@/lib/actions/markets';

/**
 * The endorsement screen's pinned action bar. Endorsing is the one thing this screen exists to
 * ask for, so it gets the accent colour and the full width of the row; "Not now" shrinks to fit
 * and stays a ghost, because walking away is a legitimate answer but not the one being proposed.
 *
 * Pinned above BottomNav rather than sitting in a card, mirroring where the bet slip lives on an
 * open market — the committing action is always in the same place on a market screen, whatever
 * stage it is at.
 */
export function EndorseActionBar({ groupId, marketId }: { groupId: string; marketId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runSponsor() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sponsorMarket(marketId);
      if (result.error) {
        // Someone else's endorsement beat this one to it (or it expired out from under them)
        // — a red error next to a still-visible "Endorse" button reads as broken, not stale.
        // A neutral notice, then a refresh, catches the page up to reality on its own.
        if (result.error.toLowerCase().includes('already sponsored') || result.error.toLowerCase().includes('expired')) {
          setNotice('Someone else just endorsed this market. Refreshing...');
          setTimeout(() => router.refresh(), 1200);
        } else {
          setError(result.error);
        }
      } else {
        router.refresh();
      }
    });
  }

  const bar = (
    <div className="mx-auto max-w-lg space-y-2.5">
      {error && <p className="text-sm font-semibold text-danger-100">{error}</p>}
      {notice && <p className="text-sm font-semibold text-paper-white/70">{notice}</p>}
      <div className="flex gap-2.5">
        <button
          type="button"
          disabled={isPending}
          onClick={runSponsor}
          className="flex-1 rounded-full bg-honey-500 px-5 py-[13px] text-[15px] font-extrabold whitespace-nowrap text-espresso-950 transition-colors hover:bg-honey-600 disabled:bg-honey-500/30 disabled:text-espresso-950/40"
        >
          Endorse it
        </button>
        <button
          type="button"
          onClick={() => router.push(`/groups/${groupId}`)}
          className="shrink-0 rounded-full border border-white/18 bg-white/6 px-[18px] py-[13px] text-[15px] font-semibold whitespace-nowrap text-paper-white/75 transition-colors hover:bg-white/12"
        >
          Not now
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Invisible in-flow twin reserving the pinned bar's real height, same trick BetslipBar
          uses — see the long note there for why a guessed padding value drifts. */}
      <div aria-hidden="true" className="invisible !m-0 px-5 pt-3.5 pb-4">
        {bar}
      </div>

      <div aria-hidden="true" className="fixed inset-x-0 bottom-[var(--bottomnav-height)] z-20 !m-0 bg-espresso-900 pb-5" />

      <div className="fixed inset-x-0 bottom-[var(--bottomnav-height)] z-30 !m-0 rounded-t-[20px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 px-5 pt-3.5 pb-4 shadow-[0_-14px_28px_-10px_rgba(28,19,13,0.4)]">
        {bar}
      </div>
    </>
  );
}
