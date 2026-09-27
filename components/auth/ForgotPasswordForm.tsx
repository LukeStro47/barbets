'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/actions/auth';
import { Field } from '@/components/ui/Field';
import { FooterButton, StickyFooter } from '@/components/ui/Screen';
import { TurnstileField } from '@/components/auth/TurnstileField';

/** No mock of its own; drawn in 5b's frame (one field, the action in the sticky footer). */
export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, null);

  if (state?.success) {
    return (
      <>
        <p className="mt-[22px] rounded-2xl border border-hairline bg-surface px-[15px] py-3.5 text-[13px] leading-[1.5] text-muted text-pretty">
          If that email has an account, a link to set a new password is on its way. Look in spam if it
          doesn&apos;t show.
        </p>
        <StickyFooter>
          <FooterButton tone="outline" href="/login">
            Back to log in
          </FooterButton>
        </StickyFooter>
      </>
    );
  }

  return (
    <form action={formAction} className="mt-[22px]">
      {state?.error && <p className="mb-4 text-[12px] font-semibold text-alert">{state.error}</p>}
      <Field label="Email" name="email" type="email" autoComplete="email" autoFocus required />
      <TurnstileField resetKey={state} />
      <Link href="/login" className="mt-[18px] block text-[12.5px] font-semibold text-faint">
        Remembered it? Log in
      </Link>
      <StickyFooter>
        <FooterButton type="submit" disabled={isPending}>
          {isPending ? 'Sending' : 'Send reset link'}
        </FooterButton>
      </StickyFooter>
    </form>
  );
}
