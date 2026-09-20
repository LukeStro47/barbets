'use client';

import { useActionState } from 'react';
import { updateEmail, updatePassword } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-hairline bg-surface px-4 py-2.5 text-ink focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15';

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, isPending] = useActionState(updateEmail, null);
  return (
    <form action={formAction} className="space-y-2">
      <label className="block text-sm font-semibold text-muted">Email</label>
      {state?.error && <p className="text-sm text-alert">{state.error}</p>}
      {state?.success && <p className="text-sm text-signal">Check your new inbox for a confirmation link.</p>}
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
      <label className="block text-sm font-semibold text-muted">Password</label>
      {state?.error && <p className="text-sm text-alert">{state.error}</p>}
      {state?.success && <p className="text-sm text-signal">Password updated.</p>}
      <input name="password" type="password" placeholder="New password" required className={inputClasses} />
      <input name="confirmPassword" type="password" placeholder="Confirm new password" required className={inputClasses} />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        Update password
      </Button>
    </form>
  );
}
