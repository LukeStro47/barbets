'use client';

import { useState } from 'react';
import { SignInForm, SignUpForm } from '@/components/auth/AuthForms';
import { AuthScreen } from '@/components/auth/AuthScreen';

/** Owns the whole screen, not just a form: sign in and sign up differ in headline and subhead as
 *  well as in fields, and switching between them still stays on one route so `next`/`mode` survive.
 *  `error` arrives as a query param from app/auth/confirm/route.ts, when a confirmation or
 *  recovery link turned out to be invalid or expired — it's local state rather than a bare prop
 *  read so switching tabs clears a stale message instead of leaving it stuck under the wrong form. */
export function AuthTabs({
  defaultMode,
  next,
  error,
}: {
  defaultMode: 'signin' | 'signup';
  next?: string;
  error?: string;
}) {
  const [mode, setMode] = useState(defaultMode);
  const [bannerError, setBannerError] = useState(error);

  function switchMode(newMode: 'signin' | 'signup') {
    setBannerError(undefined);
    setMode(newMode);
  }

  if (mode === 'signin') {
    return (
      <AuthScreen title="Welcome back." subtitle="Your markets are still running.">
        {bannerError && <p className="mt-6 text-sm text-danger-700">{bannerError}</p>}
        <SignInForm next={next} />
        <p className="mt-auto pt-8 text-center text-[15px] text-espresso-400">
          No account yet?{' '}
          <button type="button" onClick={() => switchMode('signup')} className="font-bold text-honey-700">
            Make one
          </button>
        </p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Get a seat at the table." subtitle="Two fields, then you're in.">
      {bannerError && <p className="mt-6 text-sm text-danger-700">{bannerError}</p>}
      <SignUpForm next={next} />
      <p className="mt-auto pt-8 text-center text-[15px] text-espresso-400">
        Already have one?{' '}
        <button type="button" onClick={() => switchMode('signin')} className="font-bold text-honey-700">
          Sign in
        </button>
      </p>
    </AuthScreen>
  );
}
