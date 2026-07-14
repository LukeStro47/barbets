import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { type MarketCardData } from '@/components/markets/MarketCard';
import { SeasonBanner } from '@/components/groups/SeasonBanner';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { NewMarketButton } from '@/components/groups/NewMarketButton';
import { GroupMarketSections } from '@/components/groups/GroupMarketSections';
import { Mention } from '@/components/ui/Mention';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { BarChartIcon, SettingsIcon, InfoIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/formatNumber';

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

const iconLinkClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-espresso-50 text-espresso-500 transition-colors hover:bg-espresso-100 hover:text-espresso-700 active:scale-[0.92]';

export default async function GroupFeedPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, invite_code, owner_id, deletion_scheduled_at')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = group!.owner_id === user?.id;

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
        const closedBetCount = (optionOdds ?? []).reduce((sum: number, o: any) => sum + o.bet_count, 0);
        bucket.push({ ...base, closedBetCount, optionOdds: (optionOdds ?? []).map((o: any) => ({ id: o.option_id, label: o.label, percent: o.pool_percent })) });
      } else {
        const { data: odds } = await supabase.rpc('get_closed_odds', { p_market_id: m.id });
        const closedBetCount = (odds ?? []).reduce((sum: number, o: any) => sum + o.bet_count, 0);
        bucket.push({ ...base, closedBetCount, odds: (odds ?? []).map((o: any) => ({ side: o.side, percent: o.pool_percent })) });
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
    <main className="mx-auto max-w-lg px-5 py-[22px]">
      <div className="flex flex-col gap-1.5">
        <Link href="/groups?all=1" className="text-sm font-medium text-espresso-400 hover:text-espresso-600">
          ← All groups
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 font-display text-[29px] font-bold tracking-[-0.02em] text-espresso-950">{group!.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/groups/${groupId}/leaderboard`} className={iconLinkClass} aria-label="Leaderboard">
              <BarChartIcon className="h-4 w-4" />
            </Link>
            <Link href={`/groups/${groupId}/settings`} className={iconLinkClass} aria-label={isOwner ? 'Settings' : 'Group info'}>
              {isOwner ? <SettingsIcon className="h-4 w-4" /> : <InfoIcon className="h-4 w-4" />}
            </Link>
            <NewMarketButton groupId={groupId} bettingEnabled={settings?.betting_enabled ?? false} />
          </div>
        </div>
        {season && season.status !== 'intermission' && (
          <p className="text-[13px] font-medium text-espresso-400">
            Season {season.number}
            {endsAt && (
              <>
                {' '}
                · <CountdownTimer target={endsAt} prefix="Ends in" />
              </>
            )}
          </p>
        )}
      </div>

      <div className="mt-[18px] flex flex-col gap-[18px] pb-10">
        {group!.deletion_scheduled_at && (
          <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
        )}

        <div className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-[22px]">
          <Image
            src="/barbets-coin.png"
            alt=""
            width={96}
            height={96}
            className="pointer-events-none absolute -top-4 -right-4 rotate-[-10deg] opacity-[0.14]"
          />
          <p className="relative text-[11px] font-bold tracking-[0.12em] text-honey-400 uppercase">Your balance</p>
          <p className="relative mt-1.5 font-display text-[40px] font-bold tracking-[-0.01em] text-paper-white">
            {formatTokens(membership?.balance ?? 0)}
          </p>
          <div className="relative mt-4 flex items-end justify-between border-t border-white/10 pt-3.5">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.1em] text-espresso-300 uppercase">Invite code</p>
              <p className="mt-0.5 text-sm font-semibold text-honey-200">{group!.invite_code}</p>
            </div>
            {membership?.nickname && (
              <p className="text-sm text-espresso-200">
                Playing as <Mention nickname={membership.nickname} />
              </p>
            )}
          </div>
        </div>

        {season && <SeasonBanner groupId={groupId} season={{ ...season, endsAt }} />}

        <GroupMarketSections
          pendingSponsor={buckets.pending_sponsor}
          open={buckets.open}
          awaitingResolution={buckets.awaiting_resolution}
          challenged={buckets.challenged}
          revealed={buckets.revealed}
        />
      </div>
    </main>
  );
}
