'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BETA_GATE_CODE, BETA_GATE_COOKIE } from '@/lib/betaGate';

export interface BetaGateState {
  error?: string;
}

/** Only ever redirect to a relative in-app path — never follow an absolute/external URL from form input. */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === 'string' ? next : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/login';
}

export async function checkBetaCode(_prevState: BetaGateState | null, formData: FormData): Promise<BetaGateState | null> {
  const code = String(formData.get('code')).trim();
  const next = safeNext(formData.get('next'));

  if (code.toUpperCase() !== BETA_GATE_CODE) {
    return { error: "That code doesn't work." };
  }

  const store = await cookies();
  store.set(BETA_GATE_COOKIE, '1', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  redirect(next);
}
