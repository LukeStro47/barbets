import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { JoinGroupForm } from '@/components/groups/JoinGroupForm';
import { OnboardingCarousel } from '@/components/groups/OnboardingCarousel';
import { formatTokens } from '@/lib/formatNumber';

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

  // With exactly one group, skip straight to it — the hub is still reachable
  // via ?all=1 (e.g. to join or start a second group).
  if (!all && (groups ?? []).length === 1) {
    redirect(`/groups/${groups![0].id}`);
  }

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
          {(groups ?? []).map((g: any) => {
            // Same rank definition the leaderboard page uses: non-removed members sorted by
            // balance descending, rank = array index + 1 — no RPC/window function needed for
            // a lightweight per-card badge.
            const ranked = (g.memberships ?? [])
              .filter((m: { status: string }) => m.status !== 'removed')
              .sort((a: { balance: number }, b: { balance: number }) => b.balance - a.balance);
            const myIndex = ranked.findIndex((m: { user_id: string }) => m.user_id === user?.id);
            const myRank = myIndex + 1;
            const myBalance = myIndex >= 0 ? ranked[myIndex].balance : 0;
            return (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`}>
                  <Card className="flex items-center justify-between transition-shadow hover:shadow-md">
                    <div>
                      <p className="font-display font-bold text-espresso-900">{g.name}</p>
                      <p className="text-sm text-espresso-400">
                        #{myRank} · {formatTokens(myBalance)} tokens
                      </p>
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
