import { createClient, requireUser } from '@/lib/supabase/server';
import { BottomNav, type NavGroup, type GroupBettingStatus } from '@/components/layout/BottomNav';
import { BottomNavSpacer } from '@/components/layout/BottomNavSpacer';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { PageTransition } from '@/components/layout/PageTransition';
import { PushReminderModal } from '@/components/pwa/PushReminderModal';
import { InstallBanner } from '@/components/pwa/InstallBanner';
import { getGroupTaskCounts } from '@/lib/tasks';

export default async function AppLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const supabase = await createClient();
  // This redirect is the layout's own protection, never the page's underneath it: a layout and
  // its page render in parallel, so this cannot stop one from running. Every page calls
  // requireUser() for itself. See the note on requireUser.
  const user = await requireUser(supabase);

  const { data: groupRows } = await supabase
    .from('groups')
    .select('id, name, avatar_key, owner_id, memberships(status, user_id, nickname)')
    .order('created_at', { ascending: false });

  const groupIds = (groupRows ?? []).map((g) => g.id);
  const { data: settingsRows } =
    groupIds.length > 0
      ? await supabase.from('group_settings').select('group_id, seasons_enabled, betting_enabled').in('group_id', groupIds)
      : { data: [] };
  const settingsByGroup = new Map((settingsRows ?? []).map((s) => [s.group_id, s]));

  // Betting only ever opens through the current *active* season for a seasons-enabled group —
  // winding_down/intermission/archived can't take new markets either way, same gate
  // create_market() itself uses. Fetching every status (not just 'active') is what lets the
  // "+" button's blocked-modal tell "between seasons" apart from "owner has betting off" instead
  // of collapsing both into one boolean; reduced to one row per group below since there's no
  // per-group "top 1" query shape over PostgREST.
  const seasonsEnabledGroupIds = (settingsRows ?? []).filter((s) => s.seasons_enabled).map((s) => s.group_id);
  const { data: seasonRows } =
    seasonsEnabledGroupIds.length > 0
      ? await supabase.from('seasons').select('group_id, number, status, betting_open, name').in('group_id', seasonsEnabledGroupIds)
      : { data: [] };
  const latestSeasonByGroup = new Map<string, { number: number; status: string; betting_open: boolean; name: string | null }>();
  for (const s of seasonRows ?? []) {
    const prev = latestSeasonByGroup.get(s.group_id);
    if (!prev || s.number > prev.number) latestSeasonByGroup.set(s.group_id, s);
  }

  const groups: NavGroup[] = (groupRows ?? []).map((g) => {
    const memberCount = (g.memberships ?? []).filter((m: { status: string }) => m.status === 'active' || m.status === 'dormant').length;
    return { id: g.id, name: g.name, avatarKey: g.avatar_key, meta: `${memberCount} member${memberCount === 1 ? '' : 's'}` };
  });

  const bettingStatusByGroup: Record<string, GroupBettingStatus> = {};
  for (const g of groupRows ?? []) {
    const groupSettings = settingsByGroup.get(g.id);
    if (!groupSettings?.seasons_enabled) {
      bettingStatusByGroup[g.id] = { blocked: !groupSettings?.betting_enabled, reason: 'owner_off' };
      continue;
    }
    const latest = latestSeasonByGroup.get(g.id);
    if (latest?.status === 'active') {
      bettingStatusByGroup[g.id] = { blocked: !latest.betting_open, reason: 'owner_off' };
      continue;
    }
    const ownerNickname = (g.memberships ?? []).find((m: { user_id: string; nickname: string | null }) => m.user_id === g.owner_id)?.nickname ?? undefined;
    bettingStatusByGroup[g.id] = {
      blocked: true,
      reason: latest?.status === 'winding_down' ? 'season_winding_down' : 'season_intermission',
      ownerNickname,
      seasonName: latest?.name ?? undefined,
    };
  }

  const taskCounts = await getGroupTaskCounts(supabase, groupIds, user.id);
  const hasNeedsYou = [...taskCounts.values()].some((count) => count > 0);

  return (
    // pt-[env(safe-area-inset-top)] used to live on AppHeader itself (now removed) so its own
    // background could extend up into the status bar area; with no top bar to do that, the
    // safe-area push just moves here so content still clears the notch/status bar on first paint.
    <div className="min-h-dvh bg-paper pt-[env(safe-area-inset-top)]">
      {/* That padding alone only protects the very top of the page before any scrolling — it's
          in-flow, so it scrolls away with everything else, and content then slides freely under
          the status bar (most visible on Android, where the status bar's icons sit right over
          whatever's now underneath). A fixed, paper-colored band pinned to the true top edge
          stays put regardless of scroll position, same trick the old AppHeader got for free by
          being `sticky` with its own background. Safe on an iOS notch/Dynamic Island too — it's
          driven by the same env(safe-area-inset-top) value either way, just persistent now. */}
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-paper" />
      <PushReminderModal />
      <InstallBanner />
      <PullToRefresh>
        <PageTransition>
          <BottomNavSpacer>{children}</BottomNavSpacer>
        </PageTransition>
      </PullToRefresh>
      <BottomNav groups={groups} bettingStatusByGroup={bettingStatusByGroup} hasNeedsYou={hasNeedsYou} />
      {/* The @modal parallel slot — RouteModal portals its actual content to document.body, so
          where this renders in the tree doesn't matter, only that it renders at all. */}
      {modal}
    </div>
  );
}
