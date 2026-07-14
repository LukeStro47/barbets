import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketCard, type MarketCardData } from '@/components/markets/MarketCard';
import { getWaitingOnYou, totalCount, groupByGroup, type WaitingOnYouMarket, type WaitingOnYouGroup } from '@/lib/waitingOnYou';

const toCard = (m: WaitingOnYouMarket): MarketCardData => ({
  id: m.id,
  groupId: m.group_id,
  title: m.title,
  status: m.status,
  marketType: m.market_type,
  closesAt: m.closes_at,
  outcome: m.outcome,
});

function GroupSection({ group }: { group: WaitingOnYouGroup }) {
  return (
    <Card className="space-y-4">
      <Link href={`/groups/${group.groupId}`} className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-espresso-900">{group.groupName}</h2>
        <span className="text-espresso-300">→</span>
      </Link>

      {group.awaitingVote.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">Awaiting your vote</h3>
          <div className="space-y-2">
            {group.awaitingVote.map((m) => (
              <MarketCard key={m.id} market={toCard(m)} />
            ))}
          </div>
        </div>
      )}

      {group.awaitingResolution.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">Closed, awaiting resolution</h3>
          <div className="space-y-2">
            {group.awaitingResolution.map((m) => (
              <MarketCard key={m.id} market={toCard(m)} />
            ))}
          </div>
        </div>
      )}

      {group.needsEndorsement.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">Needs an endorsement</h3>
          <div className="space-y-2">
            {group.needsEndorsement.map((m) => (
              <MarketCard key={m.id} market={toCard(m)} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const waiting = await getWaitingOnYou(supabase, user!.id);
  const groups = groupByGroup(waiting);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Waiting on you" subtitle="Everything across your groups that needs your attention." />

      {totalCount(waiting) === 0 && <EmptyState icon="✅" title="You're all caught up" subtitle="Nothing needs you right now." />}

      {groups.map((g) => (
        <GroupSection key={g.groupId} group={g} />
      ))}
    </main>
  );
}
