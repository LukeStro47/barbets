import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Copy carried over verbatim from the card this screen replaced — only the shell changed.
  if (!user) {
    return (
      <AuthScreen title="This link is invalid or has expired.">
        <Link
          href="/forgot-password"
          className="mt-9 block text-base font-bold text-honey-700 underline underline-offset-4"
        >
          Request a new one
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Set a new one." subtitle="Then we'll drop you straight back into your groups.">
      <ResetPasswordForm />
    </AuthScreen>
  );
}
