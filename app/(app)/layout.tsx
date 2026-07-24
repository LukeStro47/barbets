import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/layout/AppHeader';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { PageTransition } from '@/components/layout/PageTransition';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh bg-paper">
      <AppHeader />
      <PullToRefresh>
        <PageTransition>{children}</PageTransition>
      </PullToRefresh>
    </div>
  );
}
