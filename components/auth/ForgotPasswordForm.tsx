'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, null);

  if (state?.success) {
    return <p className="text-center text-sm text-espresso-600">If that email has an account, we sent a link to reset your password.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      <input name="email" type="email" placeholder="Email" required className={inputClasses} />
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
