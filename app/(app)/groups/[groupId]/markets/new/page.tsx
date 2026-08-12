import { createClient } from '@/lib/supabase/server';
import { CreateMarketForm } from '@/components/markets/MarketForms';
import type { MarketType } from '@/lib/marketType';

const VALID_TYPES: MarketType[] = ['yes_no', 'over_under', 'multiple_choice'];

export default async function NewMarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { groupId } = await params;
  const { type } = await searchParams;
  const initialType = VALID_TYPES.includes(type as MarketType) ? (type as MarketType) : undefined;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: members }, { data: settings }, { data: group }] = await Promise.all([
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).eq('status', 'active'),
    supabase.from('group_settings').select('timezone, require_endorsement').eq('group_id', groupId).single(),
    supabase.from('groups').select('name').eq('id', groupId).single(),
  ]);

  // A market's creator can never be its own subject, so they're not a valid @mention target here.
  const memberOptions = (members ?? [])
    .filter((m) => m.user_id !== user?.id)
    .map((m) => ({ userId: m.user_id, nickname: m.nickname }));

  return (
    <main className="mx-auto max-w-lg px-5 pt-5 pb-8">
      <CreateMarketForm
        groupId={groupId}
        groupName={group?.name ?? ''}
        members={memberOptions}
        totalMemberCount={(members ?? []).length}
        timezone={settings?.timezone ?? 'UTC'}
        requireEndorsement={settings?.require_endorsement ?? true}
        initialMarketType={initialType}
      />
    </main>
  );
}
