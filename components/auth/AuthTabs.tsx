'use client';

import { useState } from 'react';
import { SignInForm, SignUpForm } from '@/components/auth/AuthForms';

export function AuthTabs({ defaultMode, next }: { defaultMode: 'signin' | 'signup'; next?: string }) {
  const [mode, setMode] = useState(defaultMode);

  return (
    <div className="space-y-5">
      <h1 className="text-center font-display text-xl font-bold text-espresso-900">
        {mode === 'signin' ? 'Sign in' : 'Create your account'}
      </h1>

      {mode === 'signin' ? <SignInForm next={next} /> : <SignUpForm next={next} />}

      <p className="text-center text-sm text-espresso-500">
        {mode === 'signin' ? (
          <>
            New here?{' '}
            <button type="button" onClick={() => setMode('signup')} className="font-semibold text-honey-700 hover:underline">
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button type="button" onClick={() => setMode('signin')} className="font-semibold text-honey-700 hover:underline">
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
