import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { JoinGroupForm } from '@/components/groups/JoinGroupForm';
import { OnboardingCarousel } from '@/components/groups/OnboardingCarousel';
import { CaretUpIcon, CaretDownIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { formatTokens, formatOrdinal } from '@/lib/formatNumber';

export default async function GroupsHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, deletion_scheduled_at, memberships(user_id, balance, status)')
    .order('created_at', { ascending: false });

  // Net tokens per group — same definition the leaderboard page's "All-time net" card uses
  // (every ledger entry except the seed itself, so reseeding for a new season doesn't count as
  // "winning" tokens back). One query across every group the viewer's in, not one per card.
  const { data: ledgerRows } = user
    ? await supabase
        .from('ledger')
        .select('amount, memberships!inner(user_id, group_id)')
        .eq('memberships.user_id', user.id)
        .neq('reason', 'seed')
    : { data: [] };
  const netByGroup = new Map<string, number>();
  for (const row of (ledgerRows ?? []) as any[]) {
    const groupId = row.memberships.group_id;
    netByGroup.set(groupId, (netByGroup.get(groupId) ?? 0) + row.amount);
  }

  // Which groups are currently sitting in intermission — a net-tokens figure there is stale
  // (nothing's being wagered), so those cards show "Season ended" instead. Batched across every
  // group, not queried per card, same reasoning the ledger query above already uses.
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: seasonsEnabledRows } =
    groupIds.length > 0
      ? await supabase.from('group_settings').select('group_id, seasons_enabled').in('group_id', groupIds)
      : { data: [] };
  const seasonsEnabledGroupIds = (seasonsEnabledRows ?? []).filter((r) => r.seasons_enabled).map((r) => r.group_id);
  const { data: intermissionSeasonRows } =
    seasonsEnabledGroupIds.length > 0
      ? await supabase.from('seasons').select('group_id').in('group_id', seasonsEnabledGroupIds).eq('status', 'intermission')
      : { data: [] };
  const intermissionGroupIds = new Set((intermissionSeasonRows ?? []).map((r) => r.group_id));

  // With exactly one group, skip straight to it — the hub is still reachable
  // via ?all=1 (e.g. to join or start a second group).
  if (!all && (groups ?? []).length === 1) {
    redirect(`/groups/${groups![0].id}`);
  }

  // Groups whose current season has ended sink to the bottom — nothing to act on there right
  // now, so they shouldn't compete with groups still being actively played for the top of the
  // list. A stable sort (native Array#sort in every engine this app ships to) preserves the
  // existing newest-first order within each partition.
  const sortedGroups = [...(groups ?? [])].sort(
    (a, b) => (intermissionGroupIds.has(a.id) ? 1 : 0) - (intermissionGroupIds.has(b.id) ? 1 : 0)
  );

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-8">
      <PageHeader
        title="Your groups"
        subtitle="One sealed, private economy per friend group."
        action={
          <Link href="/groups/new">
            <Button size="sm">New group</Button>
          </Link>
        }
      />

      {(groups ?? []).length === 0 ? (
        <div className="space-y-3">
          <OnboardingCarousel />
          <EmptyState title="No groups yet" subtitle="Start one, or join with a friend's invite code below." />
        </div>
      ) : (
        <ul className="space-y-3">
          {sortedGroups.map((g: any) => {
            // Same rank definition the leaderboard page uses: non-removed members sorted by
            // balance descending, rank = array index + 1 — no RPC/window function needed for
            // a lightweight per-card badge.
            const ranked = (g.memberships ?? [])
              .filter((m: { status: string }) => m.status !== 'removed')
              .sort((a: { balance: number }, b: { balance: number }) => b.balance - a.balance);
            const myIndex = ranked.findIndex((m: { user_id: string }) => m.user_id === user?.id);
            const myRank = myIndex + 1;
            const myNet = netByGroup.get(g.id) ?? 0;
            const inIntermission = intermissionGroupIds.has(g.id);
            // A self-service leave sets the membership to 'dormant' rather than removing it (see
            // ARCHITECTURE.md) — the group staying in this list afterward is intentional
            // (rejoinable, balance preserved), but with nothing to distinguish it from a group
            // you're still active in it reads as "leaving did nothing." This badge is that cue.
            const myMembership = (g.memberships ?? []).find((m: { user_id: string }) => m.user_id === user?.id);
            const iLeft = myMembership?.status === 'dormant';
            return (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`}>
                  <Card className="flex items-center justify-between transition-shadow hover:shadow-md">
                    <div>
                      <p className="font-display font-bold text-espresso-900">{g.name}</p>
                      {iLeft ? (
                        <p className="text-sm font-semibold text-espresso-400">You left this group</p>
                      ) : inIntermission ? (
                        <p className="text-sm font-semibold text-espresso-400">Season ended</p>
                      ) : (
                        <p className="flex items-center gap-1 text-sm">
                          {myNet >= 0 ? (
                            <CaretUpIcon className="h-3 w-3 shrink-0 text-success-700" />
                          ) : (
                            <CaretDownIcon className="h-3 w-3 shrink-0 text-danger-700" />
                          )}
                          <span className={cn('font-semibold', myNet >= 0 ? 'text-success-700' : 'text-danger-700')}>
                            {formatTokens(Math.abs(myNet))} tokens
                          </span>
                          <span className="text-espresso-400"> · {formatOrdinal(myRank)}</span>
                        </p>
                      )}
                      {g.deletion_scheduled_at && (
                        <p className="mt-0.5 text-xs font-semibold text-danger-700">Being deleted</p>
                      )}
                    </div>
                    <span className="text-espresso-300">→</span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <h2 className="mb-3 font-semibold text-espresso-800">Join with a code</h2>
        <JoinGroupForm />
      </Card>

      {(groups ?? []).length === 0 && (
        <Link href="/demo" className="block">
          <Button size="lg" variant="outline" className="w-full">
            Try a live demo
          </Button>
        </Link>
      )}
    </main>
  );
}
