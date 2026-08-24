import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
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

  const user = await requireUser(supabase);

  const [{ data: members }, { data: settings }, { data: group }, { data: myMembership }] = await Promise.all([
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).eq('status', 'active'),
    supabase.from('group_settings').select('timezone, require_endorsement').eq('group_id', groupId).single(),
    supabase.from('groups').select('name, owner_id, is_public').eq('id', groupId).single(),
    supabase.from('memberships').select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle(),
  ]);

  // Public groups restrict hand-creating a market to mods/the owner — see
  // supabase/migrations/20260824120000_public_group_market_gates.sql. Same 404-not-403 posture
  // BottomNav's own pre-check and every other authorization gate in this app already uses.
  if (group?.is_public && group.owner_id !== user.id && myMembership?.role !== 'moderator') {
    notFound();
  }

  // A market's creator can never be its own subject, so they're not a valid @mention target here.
  // Alphabetical because the only way to find a name in a chip strip is to look for it, and
  // membership order (which is what the query returns) is an order nobody can predict.
  const memberOptions = (members ?? [])
    .filter((m) => m.user_id !== user?.id)
    .map((m) => ({ userId: m.user_id, nickname: m.nickname }))
    .sort((a, b) => a.nickname.localeCompare(b.nickname));

  return (
    <main className="mx-auto flex min-h-[var(--flow-height)] max-w-lg flex-col px-5 pt-5 pb-8">
      <CreateMarketForm
        groupId={groupId}
        groupName={group?.name ?? ''}
        members={memberOptions}
        totalMemberCount={(members ?? []).length}
        timezone={settings?.timezone ?? 'UTC'}
        requireEndorsement={settings?.require_endorsement ?? true}
        initialMarketType={initialType}
        isPublic={group?.is_public ?? false}
      />
    </main>
  );
}
