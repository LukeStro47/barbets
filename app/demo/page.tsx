import { createClient } from '@/lib/supabase/server';
import { DemoWalkthrough } from '@/components/demo/DemoWalkthrough';

export default async function DemoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <DemoWalkthrough isLoggedIn={!!user} />;
}
