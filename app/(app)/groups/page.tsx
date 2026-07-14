import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { JoinGroupForm } from '@/components/groups/JoinGroupForm';

export default async function GroupsHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, invite_code, deletion_scheduled_at, memberships(status)')
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
        <EmptyState title="No groups yet" subtitle="Start one, or join with a friend's invite code below." />
      ) : (
        <ul className="space-y-3">
          {(groups ?? []).map((g: any) => {
            const memberCount = (g.memberships ?? []).filter((m: { status: string }) => m.status === 'active').length;
            return (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`}>
                  <Card className="flex items-center justify-between transition-shadow hover:shadow-md">
                    <div>
                      <p className="font-display font-bold text-espresso-900">{g.name}</p>
                      <p className="text-sm text-espresso-400">
                        {memberCount} member{memberCount === 1 ? '' : 's'} · {g.invite_code}
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
    </main>
  );
}
