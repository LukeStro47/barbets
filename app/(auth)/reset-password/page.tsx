import { createClient } from '@/lib/supabase/server';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { FooterButton, StickyFooter } from '@/components/ui/Screen';

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <AuthScreen title="That link has expired" subtitle="Reset links only work once, and not for long. Ask for a fresh one.">
        <StickyFooter>
          <FooterButton href="/forgot-password">Send a new link</FooterButton>
        </StickyFooter>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Set a new one" subtitle="Then we'll drop you straight back into your groups.">
      <ResetPasswordForm />
    </AuthScreen>
  );
}
