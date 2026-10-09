'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updatePassword } from '@/lib/actions/auth';
import { Field } from '@/components/ui/Field';
import { FooterButton, StickyFooter } from '@/components/ui/Screen';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';

/** Reuses the existing updatePassword action (already used by ChangePasswordForm on /profile) —
    the recovery link's verifyOtp call already established a real session via cookies, so setting
    a new password here is exactly the same operation, just landing somewhere else afterward.
    Drawn like 5b: one password field with Show and the strength meter; the action still wants a
    confirmation, which Show makes redundant, so it gets the same value. */
export function ResetPasswordForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(updatePassword, null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (state?.success) router.push('/groups');
  }, [state?.success, router]);

  return (
    <form action={formAction} className="mt-[22px]">
      {state?.error && <p className="mb-4 text-[12px] font-semibold text-alert">{state.error}</p>}
      <input type="hidden" name="confirmPassword" value={password} />
      <Field
        label="New password"
        name="password"
        type="password"
        placeholder="6 characters or more"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <PasswordStrengthMeter password={password} />
      <StickyFooter>
        <FooterButton type="submit" disabled={isPending || password.length < 6}>
          {isPending ? 'Saving' : 'Set new password'}
        </FooterButton>
      </StickyFooter>
    </form>
  );
}
