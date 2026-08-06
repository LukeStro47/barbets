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
    <main className="mx-auto max-w-lg px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="mb-7 flex items-center justify-between">
        <BackButton fallbackHref={user ? '/groups' : '/'} />
        <Logo height={26} />
      </div>

      <DemoWalkthrough isLoggedIn={!!user} />
    </main>
  );
}
