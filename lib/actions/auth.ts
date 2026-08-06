'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export interface AuthActionState {
  error?: string;
}

/** Only ever redirect to a relative in-app path — never follow an absolute/external URL from form input. */
function safeNext(next: FormDataEntryValue | null, fallback: string): string {
  const value = typeof next === 'string' ? next : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

/** Ensures the public.users profile row exists — required before create_group/join_group etc. will work (memberships.user_id is a foreign key into users). Idempotent: a repeat call for an already-onboarded user is a silent no-op. */
async function ensureProfileRow(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<void> {
  await supabase.from('users').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
}

export async function signUp(_prevState: AuthActionState | null, formData: FormData): Promise<AuthActionState | null> {
  if (formData.get('agreeTerms') !== 'on') return { error: 'You need to agree to the Terms of use and Privacy policy first.' };
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const next = safeNext(formData.get('next'), '/groups');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (!data.session) {
    // Email confirmation is required on this Supabase project, so no
    // session (and no cookie) exists yet. The profile row gets created on
    // first sign-in instead. Send people back to /login with a clear next
    // step rather than redirecting somewhere that needs a session.
    return { error: 'Account created, check your email and click the confirmation link, then sign in.' };
  }
  await ensureProfileRow(supabase, data.session.user.id);
  redirect(next);
}

export async function signIn(_prevState: AuthActionState | null, formData: FormData): Promise<AuthActionState | null> {
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const next = safeNext(formData.get('next'), '/groups');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  await ensureProfileRow(supabase, data.user.id);
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/** x-forwarded-proto is set by Vercel but absent locally, where host always starts with
    localhost/127.0.0.1 — falls back to http there and https everywhere else. */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export interface RequestPasswordResetState {
  error?: string;
  success?: boolean;
}

/** resetPasswordForEmail never reveals whether the email actually has an account — it only
    errors on real problems (rate limiting, malformed input), so surfacing those directly is
    safe and doesn't add any user-enumeration risk on top of what Supabase already prevents. */
export async function requestPasswordReset(
  _prevState: RequestPasswordResetState | null,
  formData: FormData
): Promise<RequestPasswordResetState> {
  const email = String(formData.get('email'));
  const origin = await getOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });
  if (error) return { error: error.message };
  return { success: true };
}

export interface ProfileActionState {
  error?: string;
  success?: boolean;
}

/** Supabase sends a confirmation link to the new address before the change takes effect. */
export async function updateEmail(_prevState: ProfileActionState | null, formData: FormData): Promise<ProfileActionState> {
  const email = String(formData.get('email'));
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updatePassword(_prevState: ProfileActionState | null, formData: FormData): Promise<ProfileActionState> {
  const password = String(formData.get('password'));
  const confirm = String(formData.get('confirmPassword'));
  if (password !== confirm) return { error: "Passwords don't match." };
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { success: true };
}
