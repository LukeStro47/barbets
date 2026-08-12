'use client';

import { useState } from 'react';
import { SignInForm, SignUpForm } from '@/components/auth/AuthForms';
import { AuthScreen } from '@/components/auth/AuthScreen';

/** Owns the whole screen, not just a form: sign in and sign up differ in headline and subhead as
 *  well as in fields, and switching between them still stays on one route so `next`/`mode` survive. */
export function AuthTabs({ defaultMode, next }: { defaultMode: 'signin' | 'signup'; next?: string }) {
  const [mode, setMode] = useState(defaultMode);

  if (mode === 'signin') {
    return (
      <AuthScreen title="Welcome back." subtitle="Your markets are still running.">
        <SignInForm next={next} />
        <p className="mt-auto pt-8 text-center text-[15px] text-espresso-400">
          No account yet?{' '}
          <button type="button" onClick={() => setMode('signup')} className="font-bold text-honey-700">
            Make one
          </button>
        </p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Get a seat at the table." subtitle="Two fields, then you're in.">
      <SignUpForm next={next} />
      <p className="mt-auto pt-8 text-center text-[15px] text-espresso-400">
        Already have one?{' '}
        <button type="button" onClick={() => setMode('signin')} className="font-bold text-honey-700">
          Sign in
        </button>
      </p>
    </AuthScreen>
  );
}
