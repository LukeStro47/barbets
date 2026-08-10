'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sponsorMarket } from '@/lib/actions/markets';
import { Button } from '@/components/ui/Button';

/** The endorse button itself, meant to sit inside the "what happens next" timeline card
 * (step 0 there already explains why a second member's needed) rather than repeat that
 * explanation in a card of its own. */
export function EndorseAction({ marketId }: { marketId: string }) {
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

  return (
    <div className="space-y-2 border-t border-espresso-50 pt-3.5">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {notice && <p className="text-sm text-espresso-500">{notice}</p>}
      <Button disabled={isPending} onClick={runSponsor} className="w-full">
        Endorse this market
      </Button>
    </div>
  );
}
