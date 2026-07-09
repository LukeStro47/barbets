import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketCard, type MarketCardData } from '@/components/markets/MarketCard';
import { SeasonBanner } from '@/components/groups/SeasonBanner';
import { NewMarketButton } from '@/components/groups/NewMarketButton';
import { Mention } from '@/components/ui/Mention';

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function NavPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-espresso-200 bg-paper-white px-3.5 py-1.5 text-sm font-semibold text-espresso-700 transition-colors hover:border-honey-500 hover:bg-honey-50 hover:text-honey-800"
    >
      {children}
    </Link>
  );
}

export default async function GroupFeedPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase.from('groups').select('id, name, invite_code, owner_id').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('memberships')
    .select('balance, nickname')
    .eq('group_id', groupId)
    .eq('user_id', user!.id)
    .single();

  const { data: settings } = await supabase
    .from('group_settings')
    .select('seasons_enabled, season_length, betting_enabled')
    .eq('group_id', groupId)
    .single();

  const { data: season } = settings?.seasons_enabled
    ? await supabase.from('seasons').select('number, status, started_at').eq('group_id', groupId).order('number', { ascending: false }).limit(1).single()
    : { data: null };

  const { data: markets } = await supabase
    .from('visible_markets')
    .select('id, title, status, market_type, closes_at, outcome, outcome_option_id, line')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  const buckets: Record<string, MarketCardData[]> = {
    pending_sponsor: [],
    open: [],
    awaiting_resolution: [], // closed/proposed
    challenged: [], // disputed
    revealed: [], // resolved/voided
  };

  for (const m of markets ?? []) {
    const base: MarketCardData = {
      id: m.id,
      groupId,
      title: m.title,
      status: m.status,
      marketType: m.market_type,
      closesAt: m.closes_at,
      outcome: m.outcome,
      line: m.line,
    };

    if (m.status === 'pending_sponsor') {
      buckets.pending_sponsor.push(base);
    } else if (m.status === 'open') {
      const { data: count } = await supabase.rpc('get_open_bet_count', { p_market_id: m.id });
      buckets.open.push({ ...base, openBetCount: count ?? 0 });
    } else if (['closed', 'proposed', 'disputed'].includes(m.status)) {
      const bucket = m.status === 'disputed' ? buckets.challenged : buckets.awaiting_resolution;
      if (m.market_type === 'multiple_choice') {
        const { data: optionOdds } = await supabase.rpc('get_closed_odds_options', { p_market_id: m.id });
        bucket.push({ ...base, optionOdds: (optionOdds ?? []).map((o: any) => ({ id: o.option_id, label: o.label, percent: o.pool_percent })) });
      } else {
        const { data: odds } = await supabase.rpc('get_closed_odds', { p_market_id: m.id });
        bucket.push({ ...base, odds: (odds ?? []).map((o: any) => ({ side: o.side, percent: o.pool_percent })) });
      }
    } else {
      if (m.market_type === 'multiple_choice' && m.outcome_option_id) {
        const { data: option } = await supabase.from('market_options').select('label').eq('id', m.outcome_option_id).single();
        buckets.revealed.push({ ...base, outcomeLabel: option?.label ?? null });
      } else {
        buckets.revealed.push(base);
      }
    }
  }

  const endsAt =
    season && settings?.season_length && settings.season_length !== 'manual'
      ? addMonths(season.started_at, Number(settings.season_length[0]))
      : null;

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title={group!.name}
        backHref="/groups?all=1"
        backLabel="All groups"
        action={<NewMarketButton groupId={groupId} bettingEnabled={settings?.betting_enabled ?? false} />}
      />

      <div className="flex items-center justify-between rounded-2xl bg-espresso-900 px-5 py-4 text-paper-white">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-honey-400">Your balance</p>
          <p className="font-display text-3xl font-bold">{membership?.balance ?? 0}</p>
        </div>
        <div className="text-right text-sm text-espresso-200">
          <p>Invite code: {group!.invite_code}</p>
          {membership?.nickname && (
            <p className="text-xs text-espresso-300">
              Playing as <Mention nickname={membership.nickname} />
            </p>
          )}
        </div>
      </div>

      <nav className="flex flex-wrap justify-center gap-2">
        <NavPill href={`/groups/${groupId}/leaderboard`}>Leaderboard</NavPill>
        <NavPill href={`/groups/${groupId}/settings`}>Settings</NavPill>
        <NavPill href="/how-it-works">How it Works</NavPill>
      </nav>

      {season && <SeasonBanner groupId={groupId} season={{ ...season, endsAt }} />}

      {buckets.pending_sponsor.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Awaiting endorsement</h2>
          {buckets.pending_sponsor.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display font-bold text-espresso-800">Open</h2>
        {buckets.open.length === 0 ? (
          <EmptyState icon="🎲" title="Nothing open right now" subtitle="Start a market to get the pool going." />
        ) : (
          buckets.open.map((m) => <MarketCard key={m.id} market={m} />)
        )}
      </section>

      {buckets.awaiting_resolution.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Awaiting resolution</h2>
          {buckets.awaiting_resolution.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </section>
      )}

      {buckets.challenged.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Challenged</h2>
          {buckets.challenged.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </section>
      )}

      {buckets.revealed.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-espresso-800">Resolved markets</h2>
          {buckets.revealed.slice(0, 5).map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </section>
      )}

    </main>
  );
}
