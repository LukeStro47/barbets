import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <StackedLogo height={120} className="mb-2" />
          <h1 className="mt-2 font-display text-xl font-bold text-espresso-900">Reset your password</h1>
          <p className="mt-1 text-espresso-500">We'll email you a link to set a new one.</p>
        </div>

        <Card className="space-y-3">
          {error && <p className="text-sm text-danger-700">{error}</p>}
          <ForgotPasswordForm />
        </Card>

        <p className="text-center text-sm">
          <Link href="/login" className="font-medium text-espresso-500 hover:text-espresso-700">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
