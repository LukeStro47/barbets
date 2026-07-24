import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { type MarketCardData } from '@/components/markets/MarketCard';
import { SeasonBanner } from '@/components/groups/SeasonBanner';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { NewMarketButton } from '@/components/groups/NewMarketButton';
import { GroupMarketSections } from '@/components/groups/GroupMarketSections';
import { OpenSeasonBettingButton } from '@/components/groups/IntermissionActions';
import { Mention } from '@/components/ui/Mention';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { BarChartIcon, SettingsIcon, InfoIcon, TicketIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/formatNumber';
import { REACTIONS } from '@/lib/reactions';

const iconLinkClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-espresso-50 text-espresso-500 transition-colors hover:bg-espresso-100 hover:text-espresso-700 active:scale-[0.92]';

/** Mirrors the DB's own cutoff (see supabase/migrations/*_pending_sponsor_deadline.sql):
    a market stops being endorsable at 72h since creation, or 5 minutes before betting
    would close, whichever comes first. */
function sponsorDeadline(createdAt: string, closesAt: string): string {
  const byAge = new Date(createdAt).getTime() + 72 * 3_600_000;
  const byClose = new Date(closesAt).getTime() - 5 * 60_000;
  return new Date(Math.min(byAge, byClose)).toISOString();
}

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

  const { data: openBetRows } = await supabase
    .from('bets')
    .select('amount, markets!inner(group_id)')
    .eq('user_id', user!.id)
    .eq('markets.group_id', groupId)
    .is('settled_at', null);
  const pendingTokens = (openBetRows ?? []).reduce((sum, b) => sum + b.amount, 0);

  const { data: settings } = await supabase
    .from('group_settings')
    .select('seasons_enabled, season_length, betting_enabled')
    .eq('group_id', groupId)
    .single();

  const { data: season } = settings?.seasons_enabled
    ? await supabase
        .from('seasons')
        .select('id, number, status, started_at, ends_at, betting_open, name')
        .eq('group_id', groupId)
        .order('number', { ascending: false })
        .limit(1)
        .single()
    : { data: null };

  const { data: markets } = await supabase
    .from('visible_markets')
    .select('id, title, status, market_type, closes_at, created_at, resolved_at, outcome, outcome_option_id, line, unit')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  // resolution_clarifications!inner narrows to markets the current user
  // created that have at least one still-open clarification question —
  // every row in that table is currently-pending by construction (answered
  // ones are deleted, not flagged), so plain existence is the pending check.
  const { data: needsClarificationRows } = await supabase
    .from('markets')
    .select('id, resolution_clarifications!inner(id)')
    .eq('group_id', groupId)
    .eq('creator_id', user!.id);
  const needsClarificationMarketIds = new Set((needsClarificationRows ?? []).map((m) => m.id));

  const revealedMarketIds = (markets ?? []).filter((m) => ['resolved', 'voided'].includes(m.status)).map((m) => m.id);
  const { data: reactionRows } =
    revealedMarketIds.length > 0
      ? await supabase.from('market_reactions').select('market_id, emoji').in('market_id', revealedMarketIds)
      : { data: [] };
  const reactionEmojisByMarket = new Map<string, Set<string>>();
  for (const r of reactionRows ?? []) {
    if (!reactionEmojisByMarket.has(r.market_id)) reactionEmojisByMarket.set(r.market_id, new Set());
    reactionEmojisByMarket.get(r.market_id)!.add(r.emoji);
  }

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
      resolvedAt: m.resolved_at,
      outcome: m.outcome,
      line: m.line,
      unit: m.unit,
    };

    if (m.status === 'pending_sponsor') {
      buckets.pending_sponsor.push({ ...base, sponsorDeadline: sponsorDeadline(m.created_at, m.closes_at) });
    } else if (m.status === 'open') {
      const { data: count } = await supabase.rpc('get_open_bet_count', { p_market_id: m.id });
      buckets.open.push({ ...base, openBetCount: count ?? 0, needsAttention: needsClarificationMarketIds.has(m.id) });
    } else if (['closed', 'proposed', 'disputed'].includes(m.status)) {
      const bucket = m.status === 'disputed' ? buckets.challenged : buckets.awaiting_resolution;
      let proposedOutcomeLabel: string | undefined;
      if (m.status === 'proposed' || m.status === 'disputed') {
        const { data: proposalRow } = await supabase
          .from('resolution_proposals')
          .select('proposed_outcome, proposed_option_id')
          .eq('market_id', m.id)
          .single();
        if (proposalRow?.proposed_option_id) {
          const { data: option } = await supabase.from('market_options').select('label').eq('id', proposalRow.proposed_option_id).single();
          proposedOutcomeLabel = option?.label;
        } else if (proposalRow?.proposed_outcome) {
          proposedOutcomeLabel = proposalRow.proposed_outcome;
        }
      }
      if (m.market_type === 'multiple_choice') {
        const { data: optionOdds } = await supabase.rpc('get_closed_odds_options', { p_market_id: m.id });
        const closedBetCount = (optionOdds ?? []).reduce((sum: number, o: any) => sum + o.bet_count, 0);
        bucket.push({
          ...base,
          closedBetCount,
          optionOdds: (optionOdds ?? []).map((o: any) => ({ id: o.option_id, label: o.label, percent: o.pool_percent })),
          proposedOutcomeLabel,
        });
      } else {
        const { data: odds } = await supabase.rpc('get_closed_odds', { p_market_id: m.id });
        const closedBetCount = (odds ?? []).reduce((sum: number, o: any) => sum + o.bet_count, 0);
        bucket.push({
          ...base,
          closedBetCount,
          odds: (odds ?? []).map((o: any) => ({ side: o.side, percent: o.pool_percent })),
          proposedOutcomeLabel,
        });
      }
    } else {
      const emojiSet = reactionEmojisByMarket.get(m.id);
      const reactionGlyphs = emojiSet ? REACTIONS.filter((r) => emojiSet.has(r.emoji)).map((r) => r.glyph) : undefined;
      if (m.market_type === 'multiple_choice' && m.outcome_option_id) {
        const { data: option } = await supabase.from('market_options').select('label').eq('id', m.outcome_option_id).single();
        buckets.revealed.push({ ...base, outcomeLabel: option?.label ?? null, reactionGlyphs });
      } else {
        buckets.revealed.push({ ...base, reactionGlyphs });
      }
    }
  }

  buckets.revealed.sort(
    (a, b) => new Date(b.resolvedAt ?? 0).getTime() - new Date(a.resolvedAt ?? 0).getTime()
  );

  const bettingEnabled = settings?.seasons_enabled ? (season?.betting_open ?? false) : (settings?.betting_enabled ?? false);

  return (
    <main className="mx-auto max-w-lg px-5 py-[22px]">
      <div className="flex flex-col gap-1.5">
        <Link href="/groups?all=1" className="text-sm font-medium text-espresso-400 hover:text-espresso-600">
          ← All groups
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 font-display text-[29px] font-bold tracking-[-0.02em] text-espresso-950">{group!.name}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/groups/${groupId}/bets`} className={iconLinkClass} aria-label="My bets">
              <TicketIcon className="h-4 w-4" />
            </Link>
            <Link href={`/groups/${groupId}/leaderboard`} className={iconLinkClass} aria-label="Leaderboard">
              <BarChartIcon className="h-4 w-4" />
            </Link>
            <Link href={`/groups/${groupId}/settings`} className={iconLinkClass} aria-label={isOwner ? 'Settings' : 'Group info'}>
              {isOwner ? <SettingsIcon className="h-4 w-4" /> : <InfoIcon className="h-4 w-4" />}
            </Link>
            <NewMarketButton groupId={groupId} bettingEnabled={bettingEnabled} />
          </div>
        </div>
        {season && season.status !== 'intermission' && (
          <div className="flex items-center gap-2 text-[13px] font-medium text-espresso-400">
            <span>{season.name ?? `Season ${season.number}`}</span>
            {season.ends_at && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-espresso-300" />
                <CountdownTimer target={season.ends_at} prefix="Ends in" />
              </>
            )}
          </div>
        )}
        {season && season.status === 'active' && !season.betting_open && isOwner && (
          <OpenSeasonBettingButton groupId={groupId} seasonId={season.id} />
        )}
      </div>

      <div className="mt-[18px] flex flex-col gap-[18px] pb-10">
        {group!.deletion_scheduled_at && (
          <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
        )}

        <div className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-[22px]">
          <Image
            src="/barbets-mono-white.png"
            alt=""
            width={96}
            height={96}
            className="pointer-events-none absolute -top-4 -right-4 rotate-[-10deg] opacity-[0.14]"
          />
          <p className="relative text-[11px] font-bold tracking-[0.12em] text-honey-400 uppercase">Your balance</p>
          <p className="relative mt-1.5 font-display text-[40px] font-bold tracking-[-0.01em] text-paper-white">
            {formatTokens(membership?.balance ?? 0)}
          </p>
          {pendingTokens > 0 && (
            <p className="relative mt-0.5 text-xs font-medium text-honey-200/80">
              {formatTokens(pendingTokens)} tokens in active bets
            </p>
          )}
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

        {season && <SeasonBanner groupId={groupId} season={{ number: season.number, status: season.status, endsAt: season.ends_at, name: season.name }} />}

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
