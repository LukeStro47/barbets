'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { signIn, signUp } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { CheckIcon } from '@/components/ui/icons';

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null);
  return (
    <form action={formAction} className="mt-9">
      {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-3.5">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      </div>
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
  return (
    <form action={formAction} className="mt-8">
      {state?.error && <p className="mb-4 text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-6">
        <Field label="Email" name="email" type="email" placeholder="you@wherever.com" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          placeholder="6 characters or more"
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
