import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { BackButton } from '@/components/ui/BackButton';
import { DemoWalkthrough } from '@/components/demo/DemoWalkthrough';

export default async function DemoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="flex items-center justify-between">
        <BackButton fallbackHref={user ? '/groups' : '/'} />
        <Logo />
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Try it yourself</h1>
        <p className="mt-1 text-espresso-500">A fake market, real math. No signup, no real friends needed.</p>
      </div>

      <DemoWalkthrough isLoggedIn={!!user} />
    </main>
  );
}
