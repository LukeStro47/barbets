'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { SITE_ORIGIN } from '@/lib/appOrigin';

export interface AuthActionState {
  error?: string;
  success?: boolean;
}

/** Only ever redirect to a relative in-app path — never follow an absolute/external URL from form input. */
function safeNext(next: FormDataEntryValue | null, fallback: string): string {
  const value = typeof next === 'string' ? next : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

/** Vercel sets VERCEL_ENV on every deployment; preview builds run with NODE_ENV=production too,
 *  so NODE_ENV alone would gate preview traffic as well. Where VERCEL_ENV exists it is the
 *  authority, and only 'production' enforces the app-only signup gate below, so local dev and
 *  preview deploys stay signup-able from a plain browser for testing. */
const IS_PRODUCTION = process.env.VERCEL_ENV
  ? process.env.VERCEL_ENV === 'production'
  : process.env.NODE_ENV === 'production';

/** Appended to the WebView's user agent by capacitor.config.ts's `appendUserAgent` — only the native app sets this. */
const NATIVE_APP_UA_MARKER = 'BarbetsApp';

/** Off until a native build carrying `appendUserAgent` has actually shipped through both stores —
 *  turning the gate on before that would lock out every current install, not just browser
 *  visitors, since no existing install sends the marker yet. Flip to 'true' once that rollout is
 *  far enough along. Turnstile below is already live either way; this is the second, later layer. */
const APP_ONLY_SIGNUP_ENABLED = process.env.APP_ONLY_SIGNUP_ENABLED === 'true';

/** New accounts are app-only. app.mybarbets.com is reachable from any browser (it's also the
 *  origin the native app's WebView loads), which made it an easy target for signup bots hitting
 *  the page directly. This doesn't stop a determined attacker by itself, forging a user agent is
 *  trivial. Turnstile below is the real defense against that. This exists to close the plain
 *  "visit the site, fill the form" path for anyone who isn't in the app. */
async function checkSignupFromApp(): Promise<AuthActionState | null> {
  if (!IS_PRODUCTION || !APP_ONLY_SIGNUP_ENABLED) return null;
  const h = await headers();
  const ua = h.get('user-agent') ?? '';
  if (ua.includes(NATIVE_APP_UA_MARKER)) return null;
  return { error: `Create your account in the Barbets app. Download it at ${SITE_ORIGIN}/download, then sign up from there.` };
}

/** Ensures the public.users profile row exists — required before create_group/join_group etc. will work (memberships.user_id is a foreign key into users). Idempotent: a repeat call for an already-onboarded user is a silent no-op. Exported for app/auth/confirm/route.ts, which needs it too for a signup confirmed via the email link rather than the code. */
export async function ensureProfileRow(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<void> {
  await supabase.from('users').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
}

export async function signUp(_prevState: AuthActionState | null, formData: FormData): Promise<AuthActionState | null> {
  if (formData.get('agreeTerms') !== 'on') return { error: 'You need to agree to the Terms of use and Privacy policy first.' };
  const appOnlyError = await checkSignupFromApp();
  if (appOnlyError) return appOnlyError;
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const confirmPassword = String(formData.get('confirmPassword'));
  if (password !== confirmPassword) return { error: "Passwords don't match." };
  const captchaToken = String(formData.get('cf-turnstile-response') || '');
  const next = safeNext(formData.get('next'), '/groups');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { captchaToken } });
  if (error) return { error: error.message };
  if (!data.session) {
    // Email confirmation is required on this Supabase project, so no
    // session (and no cookie) exists yet. The caller shows a 6-digit code
    // entry screen (confirmSignup below) rather than dropping the user off
    // to go check their inbox unassisted.
    return { success: true };
  }
  await ensureProfileRow(supabase, data.session.user.id);
  redirect(next);
}

/** The signup confirmation email carries both a link (handled by app/auth/confirm/route.ts)
 *  and a 6-digit code; this is the code path, entered inline on the sign-up screen instead of
 *  making the user leave the app to find and tap a link. verifyOtp establishes a real session on
 *  success, same as the link does. Not gated by Turnstile: it only checks a code against the
 *  email that just went through the gated signUp() call above, it never sends anything. */
export async function confirmSignup(_prevState: AuthActionState | null, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email'));
  const token = String(formData.get('token')).trim();
  const next = safeNext(formData.get('next'), '/groups');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
  if (error) return { error: error.message };
  if (!data.user) return { error: 'Something went wrong confirming that code, try again.' };
  await ensureProfileRow(supabase, data.user.id);
  redirect(next);
}

/** Re-sends the signup confirmation email (link + code). Unlike verifyOtp above, this does send
 *  mail, so it carries Turnstile like the other supabase.auth-touching forms (see "Signup abuse
 *  protection" in ARCHITECTURE.md). */
export async function resendSignupCode(_prevState: AuthActionState | null, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email'));
  const captchaToken = String(formData.get('cf-turnstile-response') || '');
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { captchaToken } });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signIn(_prevState: AuthActionState | null, formData: FormData): Promise<AuthActionState | null> {
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const captchaToken = String(formData.get('cf-turnstile-response') || '');
  const next = safeNext(formData.get('next'), '/groups');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) return { error: error.message };
  await ensureProfileRow(supabase, data.user.id);
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
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
  const captchaToken = String(formData.get('cf-turnstile-response') || '');
  const origin = await getOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password`, captchaToken });
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
