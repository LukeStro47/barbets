'use client';

import { useActionState } from 'react';
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
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <input name="email" type="email" placeholder="Email" required className={inputClasses} />
      <input name="password" type="password" placeholder="Password (min 6 characters)" required className={inputClasses} />
      <Button type="submit" variant="outline" disabled={isPending} className="w-full">
        Create account
      </Button>
    </form>
  );
}
