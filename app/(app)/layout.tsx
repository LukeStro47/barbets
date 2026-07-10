import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/layout/AppHeader';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh bg-paper">
      <AppHeader />
      {children}
    </div>
  );
}
