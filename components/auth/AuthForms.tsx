'use client';

import { useActionState, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { confirmSignup, resendSignupCode, signIn, signUp } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { CheckIcon } from '@/components/ui/icons';
import { DeferredTurnstileButton, TurnstileField } from '@/components/auth/TurnstileField';
import { CONFIRM_CODE_LENGTH, ConfirmCodeBoxes } from '@/components/auth/ConfirmCodeBoxes';
import { StickyFooter } from '@/components/ui/Shell';
import { cn } from '@/lib/cn';

/** Four-segment strength meter for signup. Fills gain-green once the password clears the
 *  project's 6-character floor and has a bit of variety; empty segments stay on the hairline. */
function PasswordStrength({ password }: { password: string }) {
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  const strongEnough = score >= 3;

  return (
    <div className="mt-2.5" aria-hidden>
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              strongEnough ? 'bg-gain' : i < score ? 'bg-signal' : 'bg-rule'
            )}
          />
        ))}
      </div>
      {password.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-faint">
          {strongEnough ? 'Strong enough' : password.length < 6 ? 'At least 6 characters' : 'Add a mix of letters and numbers'}
        </p>
      )}
    </div>
  );
}

export function SignInForm({ next, alternate }: { next?: string; alternate?: ReactNode }) {
  const [state, formAction, isPending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');
  if (state?.needsConfirmation) {
    return <ConfirmEmailForm email={email} next={next} fromSignIn />;
  }
  return (
    <form action={formAction} className="mt-8 flex flex-1 flex-col pb-[var(--sticky-footer-offset)]">
      {state?.error && <p className="mb-4 text-sm text-alert">{state.error}</p>}
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
      <Link href="/forgot-password" className="mt-4 block text-center text-[13.5px] font-bold text-signal">
        Forgot your password?
      </Link>
      {alternate && <div className="mt-6 text-center text-[13.5px] text-muted">{alternate}</div>}
      <StickyFooter>
        <Button type="submit" variant="primary" size="lg" disabled={isPending} className="w-full">
          Sign in
        </Button>
      </StickyFooter>
    </form>
  );
}

export function SignUpForm({ next, alternate }: { next?: string; alternate?: ReactNode }) {
  const [state, formAction, isPending] = useActionState(signUp, null);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  if (state?.success) {
    return <ConfirmEmailForm email={email} next={next} />;
  }
  return (
    <form action={formAction} className="mt-8 flex flex-1 flex-col pb-[var(--sticky-footer-offset)]">
      {state?.error && <p className="mb-4 text-sm text-alert">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      {/* Continuing is the consent: the sticky CTA is the only path forward, so a separate
          checkbox would restate the same action. Server still receives agreeTerms=on. */}
      <input type="hidden" name="agreeTerms" value="on" />
      <div className="flex flex-col gap-5">
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
        <div>
          <Field
            label="Password"
            name="password"
            type="password"
            placeholder="6 characters or more"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <PasswordStrength password={password} />
        </div>
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          placeholder="Type it again"
          autoComplete="new-password"
          required
        />
      </div>

      {/* Optional and separate from the terms line under the CTA: hearing from us by email is
          not required to create an account. Unchecked by default, an explicit opt-in. */}
      <label className="mt-5 flex items-start gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-3.5">
        <input
          type="checkbox"
          name="marketingOptIn"
          checked={marketingOptIn}
          onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[8px] border text-white peer-focus-visible:ring-2 peer-focus-visible:ring-signal',
            marketingOptIn ? 'border-signal bg-signal' : 'border-hairline bg-surface'
          )}
        >
          {marketingOptIn && <CheckIcon className="h-3.5 w-3.5" />}
        </span>
        <span className="text-[13px] leading-[19px] text-muted">
          Email me about new features and other Barbets news. You can turn this off any time in your profile.
        </span>
      </label>

      <TurnstileField resetKey={state} />
      {alternate && <div className="mt-6 text-center text-[13.5px] text-muted">{alternate}</div>}

      <StickyFooter>
        <Button type="submit" variant="primary" size="lg" disabled={isPending} className="w-full">
          Create account
        </Button>
        <p className="mt-2.5 text-center text-[11.5px] leading-[1.45] text-faint">
          By continuing you agree to the{' '}
          <a href="/terms" target="_blank" className="font-semibold text-muted underline">
            Terms of use
          </a>{' '}
          and{' '}
          <a href="/privacy" target="_blank" className="font-semibold text-muted underline">
            Privacy policy
          </a>
          .
        </p>
      </StickyFooter>
    </form>
  );
}

/** Shown in place of the sign-up form once the account is created. The confirmation email
 *  carries only a 6-digit code (no link - see ARCHITECTURE.md), entered right here so nobody
 *  has to leave the app to find and tap anything. The code is entered box-per-digit, the same
 *  shape as an invite code (InviteCodeBoxes) rather than a plain text field, so it reads the
 *  same way anything else you "type a code in" does. */
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
    <div className="mt-8 flex flex-1 flex-col pb-[var(--sticky-footer-offset)]">
      <p className="text-[13.5px] leading-[1.5] text-muted">
        {fromSignIn
          ? `This account was never confirmed. Tap resend below and we'll send a fresh code to ${email}.`
          : `Account created. We sent a code to ${email}. Enter it below to confirm.`}
      </p>
      <form action={formAction} className="mt-6">
        {state?.error && <p className="mb-4 text-sm text-alert">{state.error}</p>}
        <input type="hidden" name="email" value={email} />
        {next && <input type="hidden" name="next" value={next} />}
        <ConfirmCodeBoxes onChange={setCode} />
        <StickyFooter>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={isPending || code.length < CONFIRM_CODE_LENGTH}
            className="w-full"
          >
            Confirm email
          </Button>
        </StickyFooter>
      </form>

      <form ref={resendFormRef} action={resendAction} className="mt-5">
        <input type="hidden" name="email" value={email} />
        {resendState?.error && <p className="mb-2 text-sm text-alert">{resendState.error}</p>}
        {resendState?.success ? (
          <p className="text-center text-[13.5px] text-faint">Code sent again, check your email.</p>
        ) : (
          <DeferredTurnstileButton
            formRef={resendFormRef}
            resetKey={resendState}
            disabled={isResending}
            className="block w-full text-center text-[13.5px] font-bold text-signal"
          >
            Didn&apos;t get it? Resend code
          </DeferredTurnstileButton>
        )}
      </form>
    </div>
  );
}
