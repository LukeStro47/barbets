import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { AdminBroadcastForm } from '@/components/admin/AdminBroadcastForm';
import { formatTokens } from '@/lib/formatNumber';

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="text-center">
      <p className="font-display text-3xl font-bold text-espresso-900">{formatTokens(value)}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-espresso-400">{label}</p>
    </Card>
  );
}

export default async function AdminPage() {
  const supabase = await createClient();

  // Same indistinguishable-404 posture as every other permission gate in this app — non-admins
  // never see a "you don't have permission" message, they just never see this page exist.
  const { data: isAdmin } = await supabase.rpc('is_platform_admin');
  if (!isAdmin) notFound();

  const [{ data: stats }, { data: groups }] = (await Promise.all([
    supabase.rpc('get_platform_admin_stats').single(),
    supabase.rpc('list_groups_for_admin'),
  ])) as [
    { data: { active_groups: number; total_markets: number; total_users: number } | null },
    { data: { id: string; name: string; member_count: number }[] | null },
  ];

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Admin" subtitle="Platform-wide, not scoped to any one group." backHref="/groups" />

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Active groups" value={stats?.active_groups ?? 0} />
        <StatTile label="Markets" value={stats?.total_markets ?? 0} />
        <StatTile label="Users" value={stats?.total_users ?? 0} />
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="font-semibold text-espresso-800">Send a test notification</h2>
          <p className="text-sm text-espresso-500">
            Pushes a custom title/body to every member of the chosen group, for trying out ad/marketing copy on
            real devices.
          </p>
        </div>
        <AdminBroadcastForm
          groups={(groups ?? []).map((g: any) => ({ id: g.id, name: g.name, memberCount: g.member_count }))}
        />
      </Card>
    </main>
  );
}
