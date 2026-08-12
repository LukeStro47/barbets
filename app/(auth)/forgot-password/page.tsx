import Link from 'next/link';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <AuthScreen
      title="Lost the password."
      subtitle="Happens. Give us the email and we'll send a link to set a new one."
    >
      {error && <p className="mt-6 text-sm text-danger-700">{error}</p>}
      <ForgotPasswordForm />
      <Link
        href="/login"
        className="mt-[18px] block text-center text-sm text-espresso-400 hover:text-espresso-700"
      >
        Back to sign in
      </Link>
    </AuthScreen>
  );
}
