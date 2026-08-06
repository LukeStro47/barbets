'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { signIn, signUp } from '@/lib/actions/auth';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <input name="email" type="email" placeholder="Email" required className={inputClasses} />
      <input name="password" type="password" placeholder="Password" required className={inputClasses} />
      <Button type="submit" disabled={isPending} className="w-full">
        Sign in
      </Button>
      <Link href="/forgot-password" className="block text-center text-sm text-espresso-400 hover:text-espresso-700">
        Forgot password?
      </Link>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null);
  const [agreed, setAgreed] = useState(false);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <input name="email" type="email" placeholder="Email" required className={inputClasses} />
      <input name="password" type="password" placeholder="Password (min 6 characters)" required className={inputClasses} />
      <label className="flex items-start gap-2 text-xs text-espresso-500">
        <input
          type="checkbox"
          name="agreeTerms"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-espresso-300 text-honey-600 focus:ring-honey-400"
        />
        <span>
          I agree to the{' '}
          <a href="/terms" target="_blank" className="font-semibold text-espresso-700 underline">
            Terms of use
          </a>{' '}
          and{' '}
          <a href="/privacy" target="_blank" className="font-semibold text-espresso-700 underline">
            Privacy policy
          </a>
          , including not posting abusive content.
        </span>
      </label>
      <Button type="submit" variant="outline" disabled={isPending || !agreed} className="w-full">
        Create account
      </Button>
    </form>
  );
}
