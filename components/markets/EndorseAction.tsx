'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sponsorMarket } from '@/lib/actions/markets';
import { StickyFooter } from '@/components/ui/Screen';

/** The endorsement screen's pinned action: "Endorse it" gets the accent and the width; "Not now"
 *  stays outlined, because walking away is a legitimate answer but not the one being proposed. */
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

  // The Ledger sticky footer (README pattern 4): one committing action, full width, with the
  // walk-away option as a quiet outlined button beside it. No mockup draws this screen, so it
  // uses the same footer every other market state commits from.
  return (
    <StickyFooter>
      {error && <p className="text-[12px] font-semibold text-alert">{error}</p>}
      {notice && <p className="text-[12px] font-semibold text-muted">{notice}</p>}
      <div className="flex gap-[9px]">
        <button
          type="button"
          disabled={isPending}
          onClick={runSponsor}
          className="flex-1 rounded-[14px] bg-signal py-[15px] text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] transition-colors hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
        >
          Endorse it
        </button>
        <button
          type="button"
          onClick={() => router.push(`/groups/${groupId}`)}
          className="shrink-0 rounded-[14px] border border-hairline bg-surface px-5 py-[14px] text-[15px] font-bold text-ink"
        >
          Not now
        </button>
      </div>
    </StickyFooter>
  );
}
