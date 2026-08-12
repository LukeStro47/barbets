'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updatePassword } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

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
    <form action={formAction} className="mt-9">
      {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
      <div className="flex flex-col gap-6">
        <Field label="New password" name="password" type="password" autoComplete="new-password" required />
        <Field
          label="Confirm it"
          name="confirmPassword"
          type="password"
          placeholder="Type it again"
          autoComplete="new-password"
          required
        />
      </div>
      <Button type="submit" variant="accent" size="xl" disabled={isPending} className="mt-9 w-full">
        {isPending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
