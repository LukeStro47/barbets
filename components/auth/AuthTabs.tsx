'use client';

import { useState } from 'react';
import { SignInForm, SignUpForm } from '@/components/auth/AuthForms';
import { AuthScreen } from '@/components/auth/AuthScreen';

/** Sign in and sign up (5b) on one route, so `next`/`mode` survive switching between them.
 *  `error` arrives as a query param from app/auth/confirm/route.ts when a confirmation or recovery
 *  link was invalid or expired; it's local state so switching modes clears it. */
export function AuthTabs({ defaultMode, next, error }: { defaultMode: 'signin' | 'signup'; next?: string; error?: string }) {
  const [mode, setMode] = useState(defaultMode);
  const [bannerError, setBannerError] = useState(error);

  function switchMode(newMode: 'signin' | 'signup') {
    setBannerError(undefined);
    setMode(newMode);
  }

  const link = (label: string, to: 'signin' | 'signup') => (
    <button type="button" onClick={() => switchMode(to)} className="font-semibold text-signal">
      {label}
    </button>
  );

  if (mode === 'signin') {
    return (
      <AuthScreen title="Welcome back" subtitle={<>Your markets are still running. {link('Make an account instead', 'signup')}.</>}>
        {bannerError && <p className="mt-5 text-[12px] font-semibold text-alert">{bannerError}</p>}
        <SignInForm next={next} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Make an account" subtitle={<>One account, however many groups you end up in. {link('Log in instead', 'signin')}.</>}>
      {bannerError && <p className="mt-5 text-[12px] font-semibold text-alert">{bannerError}</p>}
      <SignUpForm next={next} />
    </AuthScreen>
  );
}
