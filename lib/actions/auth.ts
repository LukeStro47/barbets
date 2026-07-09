'use server';

import { redirect } from 'next/navigation';
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
