'use client';

import { useActionState } from 'react';
import { updateEmail, updatePassword } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, isPending] = useActionState(updateEmail, null);
  return (
    <form action={formAction} className="space-y-2">
      <label className="block text-sm font-semibold text-espresso-700">Email</label>
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      {state?.success && <p className="text-sm text-honey-700">Check your new inbox for a confirmation link.</p>}
      <input name="email" type="email" defaultValue={currentEmail} required className={inputClasses} />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        Update email
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(updatePassword, null);
  return (
    <form action={formAction} className="space-y-2">
      <label className="block text-sm font-semibold text-espresso-700">Password</label>
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      {state?.success && <p className="text-sm text-honey-700">Password updated.</p>}
      <input name="password" type="password" placeholder="New password" required className={inputClasses} />
      <input name="confirmPassword" type="password" placeholder="Confirm new password" required className={inputClasses} />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        Update password
      </Button>
    </form>
  );
}
