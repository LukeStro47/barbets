'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { claimLoginReward, type LoginRewardGroup } from '@/lib/actions/loginReward';
import { Button } from '@/components/ui/Button';
import { formatTokens } from '@/lib/formatNumber';
import { LOGIN_STREAK_TARGET } from '@/lib/loginReward';
import { cn } from '@/lib/cn';

/**
 * The 7-day login reward's one piece of UI: a progress strip while the streak is under seven,
 * and the claim button (with what each group would credit) once it's there. Lives on /profile,
 * which is also where the day-7 push deep-links. After a claim it shows what landed where, and
 * refreshes the page so the record card's balance and the streak line catch up.
 */
export function LoginRewardCard({ streak, groups }: { streak: number; groups: LoginRewardGroup[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [credited, setCredited] = useState<LoginRewardGroup[] | null>(null);

  const ready = streak >= LOGIN_STREAK_TARGET;
  const payable = groups.filter((g) => g.amount > 0);
  const total = payable.reduce((sum, g) => sum + g.amount, 0);

  function claim() {
    setError(null);
    startTransition(async () => {
      const result = await claimLoginReward();
      if (result.error) {
        setError(result.error);
        return;
      }
      setCredited(result.data ?? []);
      router.refresh();
    });
  }

  if (credited) {
    const creditedTotal = credited.reduce((sum, g) => sum + g.amount, 0);
    return (
      <div className="rounded-[20px] border border-honey-300 bg-honey-50 px-4 py-3.5">
        <p className="text-sm font-extrabold text-espresso-900">
          {creditedTotal > 0 ? `Claimed, ${formatTokens(creditedTotal)} tokens landed.` : 'Claimed. Nothing to credit this time.'}
        </p>
        {credited.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {credited.map((g) => (
              <li key={g.group_id} className="flex items-baseline justify-between gap-3 text-[12.5px] text-espresso-600">
                <span className="min-w-0 truncate">{g.group_name}</span>
                <span className="shrink-0 font-bold text-honey-700">+{formatTokens(g.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11.5px] text-espresso-400">Your streak starts over tomorrow. Keep it going for the next one.</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-[20px] border px-4 py-3.5', ready ? 'border-honey-300 bg-honey-50' : 'border-espresso-100 bg-paper-white')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-espresso-900">
            {ready ? 'Seven days straight. Claim your chips.' : `Day ${Math.min(streak, LOGIN_STREAK_TARGET)} of ${LOGIN_STREAK_TARGET}`}
          </p>
          <p className="mt-0.5 text-[11.5px] text-espresso-400">
            {ready
              ? payable.length > 0
                ? `${formatTokens(total)} tokens across ${payable.length} ${payable.length === 1 ? 'group' : 'groups'}.`
                : 'None of your groups has the login reward turned on right now.'
              : 'Open the app seven days in a row to claim a reward in every group.'}
          </p>
        </div>
        {ready && (
          <Button variant="accent" size="sm" onClick={claim} disabled={isPending} className="shrink-0">
            {isPending ? 'Claiming…' : 'Claim'}
          </Button>
        )}
      </div>
      {!ready && (
        <div className="mt-2.5 flex gap-1" aria-hidden="true">
          {Array.from({ length: LOGIN_STREAK_TARGET }, (_, i) => (
            <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < streak ? 'bg-honey-500' : 'bg-espresso-100')} />
          ))}
        </div>
      )}
      {ready && payable.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {payable.map((g) => (
            <li key={g.group_id} className="flex items-baseline justify-between gap-3 text-[12.5px] text-espresso-600">
              <span className="min-w-0 truncate">{g.group_name}</span>
              <span className="shrink-0 font-bold text-honey-700">+{formatTokens(g.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-danger-700">{error}</p>}
    </div>
  );
}
