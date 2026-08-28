'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { confirmSignup, resendSignupCode, signIn, signUp } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { CheckIcon } from '@/components/ui/icons';
import { DeferredTurnstileButton, TurnstileField } from '@/components/auth/TurnstileField';
import { CONFIRM_CODE_LENGTH, ConfirmCodeBoxes } from '@/components/auth/ConfirmCodeBoxes';

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');
  if (state?.needsConfirmation) {
    return <ConfirmEmailForm email={email} next={next} fromSignIn />;
  }
  return (
    <form action={formAction} className="mt-9">
      {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-3.5">
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <TurnstileField resetKey={state} />
      <Button type="submit" variant="accent" size="xl" disabled={isPending} className="mt-9 w-full">
        Sign in
      </Button>
      <Link
        href="/forgot-password"
        className="mt-[18px] block text-center text-sm text-espresso-400 hover:text-espresso-700"
      >
        Forgot your password?
      </Link>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null);
  const [agreed, setAgreed] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [email, setEmail] = useState('');
  if (state?.success) {
    return <ConfirmEmailForm email={email} next={next} />;
  }
  return (
    <form action={formAction} className="mt-8">
      {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-6">
        <Field
          label="Email"
          name="email"
          type="email"
          placeholder="you@wherever.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          placeholder="6 characters or more"
          autoComplete="new-password"
          required
        />
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          placeholder="Type it again"
          autoComplete="new-password"
          required
        />
      </div>

      {/* The consent row is a surface of its own rather than a bare checkbox under the fields:
          it's the one thing standing between a filled-in form and a disabled CTA, so it has to
          read as a step rather than as fine print. The checkbox itself is sr-only and drawn by
          the span beside it, since a native checkbox can't take the honey fill. */}
      <label className="mt-7 flex items-start gap-3 rounded-2xl border border-espresso-100 bg-paper-white px-4 py-3.5">
        <input
          type="checkbox"
          name="agreeTerms"
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
          I agree to the{' '}
          <a
            href="/terms"
            target="_blank"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-espresso-900 underline"
          >
            Terms of use
          </a>{' '}
          and{' '}
          <a
            href="/privacy"
            target="_blank"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-espresso-900 underline"
          >
            Privacy policy
          </a>
          , including not posting abusive content.
        </span>
      </label>

      {/* Optional and separate from the terms checkbox above: agreeing to the terms is required to
          create an account, hearing from us by email is not, and folding the two into one checkbox
          would make agreeing to the terms read as agreeing to marketing too. Unchecked by default,
          an explicit opt-in rather than an opt-out. */}
      <label className="mt-3 flex items-start gap-3 rounded-2xl border border-espresso-100 bg-paper-white px-4 py-3.5">
        <input
          type="checkbox"
          name="marketingOptIn"
          checked={marketingOptIn}
          onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-espresso-900 peer-focus-visible:ring-2 peer-focus-visible:ring-honey-400 ${
            marketingOptIn ? 'border-honey-500 bg-honey-500' : 'border-espresso-200 bg-paper-white'
          }`}
        >
          {marketingOptIn && <CheckIcon className="h-3.5 w-3.5" />}
        </span>
        <span className="text-[13px]/[19px] text-espresso-400">
          Email me about new features and other Barbets news. You can turn this off any time in your profile.
        </span>
      </label>

      <TurnstileField resetKey={state} />

      <Button
        type="submit"
        variant="accent"
        size="xl"
        disabled={isPending || !agreed}
        className="mt-7 w-full"
      >
        Create account
      </Button>
    </form>
  );
}

/** Shown in place of the sign-up form once the account is created. The confirmation email
 *  carries both a link and a 6-digit code; this lets people confirm without leaving the app to
 *  find and tap the link, while the link still works as a fallback for anyone who taps it instead.
 *  The code is entered box-per-digit, the same shape as an invite code (InviteCodeBoxes) rather
 *  than a plain text field, so it reads the same way anything else you "type a code in" does. */
function ConfirmEmailForm({
  email,
  next,
  fromSignIn,
}: {
  email: string;
  next?: string;
  /** Reached by signing in on an account that was never confirmed, rather than by just having
   *  created one - same screen, different lead-in, since there's no fresh code waiting in their
   *  inbox yet. */
  fromSignIn?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(confirmSignup, null);
  const [resendState, resendAction, isResending] = useActionState(resendSignupCode, null);
  const [code, setCode] = useState('');
  const resendFormRef = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-9">
      <p className="text-sm text-honey-700">
        {fromSignIn
          ? `This account was never confirmed. Tap resend below and we'll send a fresh code to ${email}.`
          : `Account created. We sent a code to ${email}, enter it below to confirm.`}
      </p>
      <form action={formAction} className="mt-6">
        {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
        <input type="hidden" name="email" value={email} />
        {next && <input type="hidden" name="next" value={next} />}
        <ConfirmCodeBoxes onChange={setCode} />
        <Button
          type="submit"
          variant="accent"
          size="xl"
          disabled={isPending || code.length < CONFIRM_CODE_LENGTH}
          className="mt-7 w-full"
        >
          Confirm email
        </Button>
      </form>

      <form ref={resendFormRef} action={resendAction} className="mt-5">
        <input type="hidden" name="email" value={email} />
        {resendState?.error && <p className="mb-2 text-sm text-danger-700">{resendState.error}</p>}
        {resendState?.success ? (
          <p className="text-center text-sm text-espresso-400">Code sent again, check your email.</p>
        ) : (
          <DeferredTurnstileButton
            formRef={resendFormRef}
            resetKey={resendState}
            disabled={isResending}
            className="block w-full text-center text-sm font-semibold text-honey-700"
          >
            Didn&apos;t get it? Resend code
          </DeferredTurnstileButton>
        )}
      </form>
    </div>
  );
}
