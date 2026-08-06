import { type EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** The target of the link in Supabase's Reset Password email template (customized to point here
    with token_hash/type/next instead of the default {{ .ConfirmationURL }} — see ARCHITECTURE.md
    or the setup notes for why: this app's Supabase project's recovery flow uses verifyOtp, not
    the PKCE code-exchange pattern). Establishes a real session via the recovery token, then hands
    off to `next` (in practice always /reset-password) to actually set a new password. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/reset-password';

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(safeNext);
    }
  }

  redirect('/forgot-password?error=' + encodeURIComponent('That link is invalid or has expired, request a new one.'));
}
