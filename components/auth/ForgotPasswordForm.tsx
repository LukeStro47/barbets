'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, null);

  if (state?.success) {
    return (
      <p className="mt-9 text-base/6 text-espresso-500">
        If that email has an account, we sent a link to reset your password.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-9">
      {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
      <Field label="Email" name="email" type="email" autoComplete="email" autoFocus required />
      <Button type="submit" variant="accent" size="xl" disabled={isPending} className="mt-8 w-full">
        {isPending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
