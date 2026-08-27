import { createClient } from '@/lib/supabase/server';
import { DemoWalkthrough } from '@/components/demo/DemoWalkthrough';

export default async function DemoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg px-5 pt-[calc(env(safe-area-inset-top)+40px)]">
      <DemoWalkthrough isLoggedIn={!!user} />
    </main>
  );
}
