import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens } from '@/lib/formatNumber';

interface BetRow {
  id: string;
  side: string | null;
  option_id: string | null;
  amount: number;
  payout: number | null;
  settled_at: string | null;
  market_id: string;
  markets: { title: string; outcome: string | null } | null;
}

const listClass = 'overflow-hidden rounded-2xl border border-espresso-100 bg-paper-white';
const rowClass = 'flex items-center justify-between gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-espresso-50';

export default async function MyBetsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: bets } = await supabase
    .from('bets')
    .select('id, side, option_id, amount, payout, settled_at, market_id, markets!inner(title, outcome, group_id)')
    .eq('user_id', user!.id)
    .eq('markets.group_id', groupId)
    .order('created_at', { ascending: false });

  const myBets = (bets ?? []) as unknown as BetRow[];

  const optionIds = [...new Set(myBets.map((b) => b.option_id).filter((id): id is string => !!id))];
  const { data: options } =
    optionIds.length > 0 ? await supabase.from('market_options').select('id, label').in('id', optionIds) : { data: [] };
  const optionLabelById = new Map((options ?? []).map((o) => [o.id, o.label]));

  const openBets = myBets.filter((b) => !b.settled_at);
  const pastBets = myBets.filter((b) => b.settled_at);

  function betLabel(b: BetRow) {
    return (b.option_id ? (optionLabelById.get(b.option_id) ?? '') : (b.side ?? '')).toUpperCase();
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="My bets" backHref={`/groups/${groupId}`} backLabel="Group" />

      {myBets.length === 0 ? (
        <EmptyState icon="🎫" title="No bets yet" subtitle="Place one from any open market." />
      ) : (
        <>
          <div className="space-y-2">
            <h2 className="mx-0.5 text-[13px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">Open</h2>
            {openBets.length === 0 ? (
              <p className="text-sm text-espresso-400">Nothing open right now.</p>
            ) : (
              <ul className={listClass}>
                {openBets.map((b, i) => (
                  <li key={b.id} className={i > 0 ? 'border-t border-espresso-100' : ''}>
                    <Link href={`/groups/${groupId}/markets/${b.market_id}`} className={rowClass}>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-espresso-800">{b.markets?.title}</p>
                        <p className="text-xs text-espresso-400">
                          {formatTokens(b.amount)} on <OptionLabel label={betLabel(b)} />
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-espresso-400">pending</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="mx-0.5 text-[13px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">Past</h2>
            {pastBets.length === 0 ? (
              <p className="text-sm text-espresso-400">No settled bets yet.</p>
            ) : (
              <ul className={listClass}>
                {pastBets.map((b, i) => {
                  const refunded = b.markets?.outcome === 'void';
                  const won = !refunded && (b.payout ?? 0) > 0;
                  const lost = !refunded && (b.payout ?? 0) === 0;
                  return (
                    <li key={b.id} className={i > 0 ? 'border-t border-espresso-100' : ''}>
                      <Link href={`/groups/${groupId}/markets/${b.market_id}/reveal`} className={rowClass}>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-espresso-800">{b.markets?.title}</p>
                          <p className="text-xs text-espresso-400">
                            {formatTokens(b.amount)} on <OptionLabel label={betLabel(b)} />
                          </p>
                        </div>
                        {refunded && <span className="shrink-0 text-xs font-semibold text-espresso-400">refunded</span>}
                        {won && (
                          <span className="shrink-0 text-xs font-semibold text-success-700">
                            +{formatTokens((b.payout ?? 0) - b.amount)} won
                          </span>
                        )}
                        {lost && <span className="shrink-0 text-xs font-semibold text-espresso-300">-{formatTokens(b.amount)} lost</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}
