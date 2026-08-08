import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BottomNav, type NavGroup } from '@/components/layout/BottomNav';
import { BottomNavSpacer } from '@/components/layout/BottomNavSpacer';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { PageTransition } from '@/components/layout/PageTransition';
import { PushReminderModal } from '@/components/pwa/PushReminderModal';
import { InstallBanner } from '@/components/pwa/InstallBanner';
import { initials } from '@/lib/initials';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name, memberships(status)')
    .order('created_at', { ascending: false });

  const groupIds = (groupRows ?? []).map((g) => g.id);
  const { data: settingsRows } =
    groupIds.length > 0
      ? await supabase.from('group_settings').select('group_id, seasons_enabled, betting_enabled').in('group_id', groupIds)
      : { data: [] };
  const settingsByGroup = new Map((settingsRows ?? []).map((s) => [s.group_id, s]));

  // Betting only ever opens through the current *active* season for a seasons-enabled group
  // (winding_down/intermission/archived can't take new markets either way, same gate
  // create_market() itself uses) — see GroupFeedPage's identical bettingEnabled formula.
  const seasonsEnabledGroupIds = (settingsRows ?? []).filter((s) => s.seasons_enabled).map((s) => s.group_id);
  const { data: activeSeasonRows } =
    seasonsEnabledGroupIds.length > 0
      ? await supabase.from('seasons').select('group_id, betting_open').in('group_id', seasonsEnabledGroupIds).eq('status', 'active')
      : { data: [] };
  const activeSeasonBettingOpenByGroup = new Map((activeSeasonRows ?? []).map((s) => [s.group_id, s.betting_open]));

  const groups: NavGroup[] = (groupRows ?? []).map((g) => {
    const memberCount = (g.memberships ?? []).filter((m: { status: string }) => m.status === 'active' || m.status === 'dormant').length;
    return { id: g.id, name: g.name, initials: initials(g.name), meta: `${memberCount} member${memberCount === 1 ? '' : 's'}` };
  });

  const bettingEnabledByGroup: Record<string, boolean> = {};
  for (const g of groupRows ?? []) {
    const settings = settingsByGroup.get(g.id);
    bettingEnabledByGroup[g.id] = settings?.seasons_enabled ? (activeSeasonBettingOpenByGroup.get(g.id) ?? false) : (settings?.betting_enabled ?? false);
  }

  return (
    // pt-[env(safe-area-inset-top)] used to live on AppHeader itself (now removed) so its own
    // background could extend up into the status bar area; with no top bar to do that, the
    // safe-area push just moves here so content still clears the notch/status bar.
    <div className="min-h-dvh bg-paper pt-[env(safe-area-inset-top)]">
      <PushReminderModal />
      <InstallBanner />
      <PullToRefresh>
        <PageTransition>
          <BottomNavSpacer>{children}</BottomNavSpacer>
        </PageTransition>
      </PullToRefresh>
      <BottomNav groups={groups} bettingEnabledByGroup={bettingEnabledByGroup} />
    </div>
  );
}
