import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { GameOfWeekPicker } from '@/components/admin/GameOfWeekPicker';
import type { GameOfWeekPick } from '@/lib/actions/admin';

export default async function GameOfWeekAdminPage() {
  const supabase = await createClient();

  // Same indistinguishable-404 posture as /admin itself and every other permission gate in this
  // app — non-admins never see a "you don't have permission" message, they just never see this
  // page exist.
  const { data: isAdmin } = await supabase.rpc('is_platform_admin');
  if (!isAdmin) notFound();

  const { data: picks } = (await supabase.rpc('list_game_of_week_picks')) as { data: GameOfWeekPick[] | null };

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="Game of the Week"
        subtitle="Pick this week's marquee matchup for each league. Both go live Tuesday morning."
        backHref="/admin"
      />
      <GameOfWeekPicker picks={picks ?? []} />
    </main>
  );
}
