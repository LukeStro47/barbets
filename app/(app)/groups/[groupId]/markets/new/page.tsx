import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { CreateMarketForm } from '@/components/markets/MarketForms';

export default async function NewMarketPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: members }, { data: settings }] = await Promise.all([
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).eq('status', 'active'),
    supabase.from('group_settings').select('timezone').eq('group_id', groupId).single(),
  ]);

  // A market's creator can never be its own subject, so they're not a valid @mention target here.
  const memberOptions = (members ?? [])
    .filter((m) => m.user_id !== user?.id)
    .map((m) => ({ userId: m.user_id, nickname: m.nickname }));

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="New market" backHref={`/groups/${groupId}`} backLabel="Group" />
      <CreateMarketForm
        groupId={groupId}
        members={memberOptions}
        totalMemberCount={(members ?? []).length}
        timezone={settings?.timezone ?? 'UTC'}
      />
    </main>
  );
}
