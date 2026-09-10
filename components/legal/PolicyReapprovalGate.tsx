'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';
import { CheckIcon } from '@/components/ui/icons';
import { acceptCurrentPolicy } from '@/lib/actions/legal';

/**
 * A full-screen, undismissable block for a signed-in user whose users.accepted_policy_version
 * doesn't match lib/legal.ts's CURRENT_POLICY_VERSION — mounted from app/(app)/layout.tsx, which
 * does the version comparison server-side and only renders this when they actually differ, so an
 * up-to-date user never sees so much as a flash of it. Full-screen, no way to see the real page
 * underneath, one action out: this is meant to actually gate, not just suggest.
 *
 * On accept, calls the server action and then router.refresh() rather than optimistically
 * unmounting itself — the parent layout is what decided to render this in the first place, so it
 * has to be the one to decide to stop, off the same accepted_policy_version read it already did.
 */
export function PolicyReapprovalGate() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptCurrentPolicy();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 bg-paper px-6 py-11 text-center">
      <StackedLogo height={130} />
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-espresso-950">
          Our terms and privacy policy have changed
        </h1>
        <p className="mt-2.5 max-w-[300px] text-[15px] leading-[1.5] text-espresso-500">
          Take a look, then agree to keep using Barbets.
        </p>
      </div>

      <label className="flex w-full max-w-[300px] items-start gap-3 rounded-2xl border border-espresso-100 bg-paper-white px-4 py-3.5 text-left">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-espresso-900 peer-focus-visible:ring-2 peer-focus-visible:ring-honey-400 ${
            agreed ? 'border-honey-500 bg-honey-500' : 'border-espresso-200 bg-paper-white'
          }`}
        >
          {agreed && <CheckIcon className="h-3.5 w-3.5" />}
        </span>
        <span className="text-[13px]/[19px] text-espresso-400">
          I agree to the updated{' '}
          <a href="/terms" target="_blank" onClick={(e) => e.stopPropagation()} className="font-semibold text-espresso-900 underline">
            Terms of use
          </a>{' '}
          and{' '}
          <a href="/privacy" target="_blank" onClick={(e) => e.stopPropagation()} className="font-semibold text-espresso-900 underline">
            Privacy policy
          </a>
          .
        </span>
      </label>

      {error && <p className="max-w-[300px] text-sm text-danger-700">{error}</p>}

      <Button variant="accent" size="xl" disabled={!agreed || isPending} onClick={handleAccept} className="w-full max-w-[300px]">
        Continue
      </Button>
    </div>
  );
}
