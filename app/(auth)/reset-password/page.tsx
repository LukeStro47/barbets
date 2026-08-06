import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <StackedLogo height={120} className="mb-2" />
          <h1 className="mt-2 font-display text-xl font-bold text-espresso-900">Set a new password</h1>
        </div>

        <Card className="space-y-3">
          {user ? (
            <ResetPasswordForm />
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-espresso-600">This link is invalid or has expired.</p>
              <Link href="/forgot-password" className="text-sm font-semibold text-honey-700 underline">
                Request a new one
              </Link>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
