import { AuthScreen } from '@/components/auth/AuthScreen';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <AuthScreen title="Lost the password" subtitle="Happens. Give us the email and we'll send a link to set a new one.">
      {error && <p className="mt-5 text-[12px] font-semibold text-alert">{error}</p>}
      <ForgotPasswordForm />
    </AuthScreen>
  );
}
