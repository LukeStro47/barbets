import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketCard, type MarketCardData } from '@/components/markets/MarketCard';
import { getWaitingOnYou, totalCount, type WaitingOnYouMarket } from '@/lib/waitingOnYou';

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const waiting = await getWaitingOnYou(supabase, user!.id);

  const toCard = (m: WaitingOnYouMarket): MarketCardData => ({
    id: m.id,
    groupId: m.group_id,
    title: m.title,
    groupName: m.groups?.name,
    status: m.status,
    marketType: m.market_type,
    closesAt: m.closes_at,
    outcome: m.outcome,
  });

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-8">
      <PageHeader title="Waiting on you" subtitle="Everything across your groups that needs your attention." />

      {totalCount(waiting) === 0 && <EmptyState icon="✅" title="You're all caught up" subtitle="Nothing needs you right now." />}

      {waiting.awaitingVote.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Awaiting your vote</h2>
          {waiting.awaitingVote.map((m) => (
            <MarketCard key={m.id} market={toCard(m)} />
          ))}
        </section>
      )}

      {waiting.awaitingResolution.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Closed, awaiting resolution</h2>
          {waiting.awaitingResolution.map((m) => (
            <MarketCard key={m.id} market={toCard(m)} />
          ))}
        </section>
      )}

      {waiting.needsEndorsement.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Needs an endorsement</h2>
          {waiting.needsEndorsement.map((m) => (
            <MarketCard key={m.id} market={toCard(m)} />
          ))}
        </section>
      )}
    </main>
  );
}
