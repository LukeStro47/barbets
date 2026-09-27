'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { confirmSignup, resendSignupCode, signIn, signUp } from '@/lib/actions/auth';
import { Field } from '@/components/ui/Field';
import { CheckIcon } from '@/components/ui/icons';
import { StickyFooter, HeaderTile } from '@/components/ui/Screen';
import { DeferredTurnstileButton, TurnstileField } from '@/components/auth/TurnstileField';
import { CONFIRM_CODE_LENGTH, ConfirmCodeBoxes } from '@/components/auth/ConfirmCodeBoxes';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';
import { cn } from '@/lib/cn';

const ctaClasses =
  'block w-full rounded-[14px] bg-signal py-[15px] text-center text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none';

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null);
  const [email, setEmail] = useState('');
  if (state?.needsConfirmation) {
    return <ConfirmEmailForm email={email} next={next} fromSignIn />;
  }
  return (
    <form action={formAction} className="mt-[22px]">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-4">
        <Field label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div>
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          {/* 5p: a wrong password says so under the field, with the way out right there. */}
          {state?.error && (
            <p className="mt-2 text-[12px] font-semibold text-alert">
              {state.error.replace(/\.$/, '')}.{' '}
              <Link href="/forgot-password" className="text-signal">
                Email yourself a reset
              </Link>
              .
            </p>
          )}
        </div>
      </div>
      <TurnstileField resetKey={state} />
      <Link href="/forgot-password" className="mt-[18px] block text-[12.5px] font-semibold text-faint">
        Forgot your password?
      </Link>
      <StickyFooter>
        <button type="submit" disabled={isPending} className={ctaClasses}>
          {isPending ? 'Logging in' : 'Log in'}
        </button>
      </StickyFooter>
    </form>
  );
}

/**
 * 5b. Email and a password with Show and the strength meter; nothing else is asked for. Agreeing
 * to the house rules is the line above the button ("By continuing you agree..."), as the mock
 * draws it. The email opt-in stays a separate, unticked choice: consent to marketing has to be an
 * affirmative act, never implied by creating an account.
 */
export function SignUpForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  if (state?.success) {
    return <ConfirmEmailForm email={email} next={next} />;
  }
  return (
    <form action={formAction} className="mt-[22px]">
      {state?.error && <p className="mb-4 text-[12px] font-semibold text-alert">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="agreeTerms" value="on" />
      {/* The action still double-checks the password; with Show on the field, one entry is enough. */}
      <input type="hidden" name="confirmPassword" value={password} />
      <div className="flex flex-col gap-4">
        <Field label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          <PasswordStrengthMeter password={password} />
        </div>
      </div>

      <label className="mt-[18px] flex items-start gap-2.5">
        <input type="checkbox" name="marketingOptIn" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden
          className={cn(
            'mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border text-surface peer-focus-visible:ring-2 peer-focus-visible:ring-signal',
            marketingOptIn ? 'border-signal bg-signal' : 'border-dash bg-surface'
          )}
        >
          {marketingOptIn && <CheckIcon className="h-3 w-3" />}
        </span>
        <span className="text-[12px] leading-[1.5] text-faint">Email me about new features. Off any time from You.</span>
      </label>

      <p className="mt-3 text-[11.5px] leading-[1.55] text-faint text-pretty">
        By continuing you agree to the{' '}
        <a href="/terms" target="_blank" className="text-signal">
          house rules
        </a>{' '}
        and{' '}
        <a href="/privacy" target="_blank" className="text-signal">
          privacy policy
        </a>
        . 18+.
      </p>

      <TurnstileField resetKey={state} />

      <StickyFooter>
        <button type="submit" disabled={isPending || !email || password.length < 6} className={ctaClasses}>
          {isPending ? 'Creating your account' : 'Create account'}
        </button>
      </StickyFooter>
    </form>
  );
}

const RESEND_WAIT_S = 30;

/**
 * 5c: "Six digits". Replaces the sign-up form once the account exists (the email carries only a
 * code, no link, see ARCHITECTURE.md). Its own full screen: a back tile titled "Check your inbox",
 * the six mono boxes, a resend countdown, a spam hint, and Confirm in the footer, disabled until
 * every digit is in.
 */
function ConfirmEmailForm({ email, next, fromSignIn }: { email: string; next?: string; fromSignIn?: boolean }) {
  const [state, formAction, isPending] = useActionState(confirmSignup, null);
  const [resendState, resendAction, isResending] = useActionState(resendSignupCode, null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(fromSignIn ? 0 : RESEND_WAIT_S);
  const resendFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resendState?.success) setWait(RESEND_WAIT_S);
  }, [resendState]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
      <header className="sticky top-0 z-10 border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="mx-auto flex max-w-[430px] items-center gap-[11px] px-3.5 pb-[11px]">
          <HeaderTile onClick={() => window.location.reload()} label="Change email" />
          <span className="min-w-0 flex-1 text-[15px] font-extrabold tracking-[-0.015em] text-ink">Check your inbox</span>
        </div>
      </header>
      <div className="mx-auto max-w-[430px] px-[22px] pt-5 pb-[140px]">
      <form action={formAction}>
        <h1 className="text-[27px] leading-[1.14] font-extrabold tracking-[-0.025em] text-ink">Six digits</h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted">
          {fromSignIn ? 'This account was never confirmed. Resend below and a fresh code goes to ' : 'Sent to '}
          <span className="font-semibold text-ink">{email}</span>
          {!fromSignIn && (
            <>
              {' · '}
              <button type="button" onClick={() => window.location.reload()} className="text-signal">
                change
              </button>
            </>
          )}
        </p>
        {state?.error && <p className="mt-4 text-[12px] font-semibold text-alert">{state.error}</p>}
        <input type="hidden" name="email" value={email} />
        {next && <input type="hidden" name="next" value={next} />}
        <div className="mt-6">
          <ConfirmCodeBoxes onChange={setCode} />
        </div>
        <StickyFooter>
          <button type="submit" disabled={isPending || code.length < CONFIRM_CODE_LENGTH} className={ctaClasses}>
            {isPending ? 'Confirming' : 'Confirm'}
          </button>
        </StickyFooter>
      </form>

        <form ref={resendFormRef} action={resendAction} className="mt-4 flex items-center justify-between gap-2.5">
          <input type="hidden" name="email" value={email} />
          <span className="text-[12.5px] text-faint">{resendState?.success ? 'Sent again.' : "Didn't arrive?"}</span>
          {wait > 0 ? (
            <span className="font-mono text-[12.5px] font-semibold text-faint">
              Resend in 0:{String(wait).padStart(2, '0')}
            </span>
          ) : (
            <DeferredTurnstileButton formRef={resendFormRef} resetKey={resendState} disabled={isResending} className="font-mono text-[12.5px] font-semibold text-signal">
              Resend code
            </DeferredTurnstileButton>
          )}
        </form>
        {resendState?.error && <p className="mt-2 text-[12px] font-semibold text-alert">{resendState.error}</p>}

        <div className="mt-[22px] flex items-center gap-[11px] rounded-2xl border border-hairline bg-surface px-[15px] py-3.5">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-tile text-muted">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="4" y="5" width="16" height="12" rx="2" />
              <path d="M4 8l8 5 8-5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-muted text-pretty">
            Nothing there? Look in spam for an email from <span className="font-semibold text-ink">Barbets</span>.
          </span>
        </div>
      </div>
    </div>
  );
}
