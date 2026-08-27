import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureProfileRow } from '@/lib/actions/auth';

/** The target of the link in the Reset Password email template (customized in the Supabase
    dashboard to point here with token_hash/type/next instead of the default {{ .ConfirmationURL }}
    — see ARCHITECTURE.md: this app's Supabase project's flows use verifyOtp, not the PKCE
    code-exchange pattern). The Confirm signup template no longer carries a link at all (code
    only, entered via ConfirmEmailForm/confirmSignup()), but this route still handles
    type=signup too — belt-and-braces for anyone who still has an old confirmation email sitting
    unread in their inbox from before that change. verifyOtp establishes a real session either
    way, but only a signup needs a profile row created (a recovery's user already has one, and
    ensureProfileRow is an idempotent no-op for them). Without this route, the default
    {{ .ConfirmationURL }} verifies against Supabase's own /auth/v1/verify endpoint and redirects
    with the session in a URL fragment our server-rendered pages never see, landing back on the
    signed-out splash with no sign of anything having happened. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next');
  const defaultNext = type === 'recovery' ? '/reset-password' : '/demo';
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : defaultNext;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (type === 'signup' && data.user) {
        await ensureProfileRow(supabase, data.user.id, data.user.user_metadata?.marketing_opt_in === true);
      }
      redirect(safeNext);
    }
  }

  const errorMessage = encodeURIComponent('That link is invalid or has expired, request a new one.');
  redirect(type === 'signup' ? `/login?mode=signup&error=${errorMessage}` : `/forgot-password?error=${errorMessage}`);
}
