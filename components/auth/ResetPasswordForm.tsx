'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updatePassword } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** Reuses the existing updatePassword action (already used by ChangePasswordForm on /profile) —
    the recovery link's verifyOtp call already established a real session via cookies, so setting
    a new password here is exactly the same operation, just landing somewhere else afterward. */
export function ResetPasswordForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(updatePassword, null);

  useEffect(() => {
    if (state?.success) router.push('/groups');
  }, [state?.success, router]);

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      <input name="password" type="password" placeholder="New password" required className={inputClasses} />
      <input name="confirmPassword" type="password" placeholder="Confirm new password" required className={inputClasses} />
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
