import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/groups');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] text-center">
      <StackedLogo height={160} className="mb-8" />
      <h1 className="font-display text-4xl font-bold tracking-tight text-espresso-900">
        Prediction markets for your friend group.
      </h1>
      <p className="mt-4 max-w-sm text-lg text-espresso-500">
        No real money, ever. Create a private group, invite your friends with a code, and run markets about
        anything, including each other.
      </p>
      <div className="mt-8 flex w-full max-w-xs flex-col items-center gap-4">
        <Link href="/login?mode=signup" className="w-full">
          <Button size="lg" className="w-full">
            Start Betting
          </Button>
        </Link>
        <Link href="/how-it-works" className="w-full">
          <Button variant="outline" size="lg" className="w-full">
            How it works
          </Button>
        </Link>
        <Link href="/login" className="text-sm font-medium text-espresso-400 hover:text-espresso-700">
          Already have an account? Sign in
        </Link>
      </div>
    </main>
  );
}
