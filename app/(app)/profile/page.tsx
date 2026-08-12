import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/actions/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  ChevronRightIcon,
  ShieldCheckIcon,
  ShieldAlertIcon,
  BellIcon,
  InfoIcon,
  ChatIcon,
  DocumentIcon,
  LockIcon,
  SignOutIcon,
} from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { GroupSwitcher } from '@/components/profile/GroupSwitcher';
import { ShareRecordCard } from '@/components/profile/ShareRecordCard';
import { formatTokens, formatOrdinal } from '@/lib/formatNumber';
import { MARKET_TYPE_LABEL } from '@/lib/marketType';

const LINKS = [
  { label: 'How it works', href: '/how-it-works', Icon: InfoIcon },
  { label: 'Feedback', href: '/feedback', Icon: ChatIcon },
  { label: 'Terms', href: '/terms', Icon: DocumentIcon },
  { label: 'Privacy', href: '/privacy', Icon: LockIcon },
];

/** The two real destinations: everything about the account itself, and everything about what
 * reaches your phone. Deliberately identical in weight — notifications used to be a clause inside
 * the account row's subtitle, which made the one setting people actually go looking for the one
 * setting with no row of its own. */
function SettingsRow({
  href,
  label,
  sub,
  Icon,
}: {
  href: string;
  label: string;
  sub: string;
  Icon: (props: { className?: string }) => React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-[20px] border border-espresso-100 bg-paper-white px-4 py-3.5 transition-colors hover:border-espresso-200"
    >
      <Icon className="h-[19px] w-[19px] shrink-0 text-espresso-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-espresso-800">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-espresso-400">{sub}</span>
      </span>
      <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-espresso-300" />
    </Link>
  );
}

/** The small print links, as tappable tiles rather than a wrapped row of underlined text — same
 * card language as the rows above them, so the bottom of the page reads as one set of
 * destinations instead of a card followed by a footer. */
function QuickLink({ href, label, Icon }: { href: string; label: string; Icon: (props: { className?: string }) => React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-2xl border border-espresso-100 bg-paper-white px-3 py-[13px] transition-colors hover:border-espresso-200"
    >
      <Icon className="h-4 w-4 shrink-0 text-espresso-500" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-extrabold text-espresso-700">{label}</span>
    </Link>
  );
}

/** /profile — one group at a time (see README's per-group identity rule: there is no
 * cross-group aggregate anywhere, so a stat with no group attached would be meaningless).
 * ?group= picks which one; BottomNav's You tab sets it to whatever group you were just in, and
 * defaults to the most recently joined one otherwise (e.g. arriving from the all-groups hub). */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: isAdmin } = await supabase.rpc('is_platform_admin');

  const { data: memberships } = await supabase
    .from('memberships')
    .select('group_id, nickname, balance, joined_at, groups(name, avatar_key)')
    .eq('user_id', user!.id)
    .neq('status', 'removed')
    .order('joined_at', { ascending: false });

  const accountLinks = (
    <div className="space-y-3.5">
      <div className="space-y-2">
        <SettingsRow
          href="/profile/account"
          label="Account & security"
          sub="Email, password, delete account"
          Icon={ShieldCheckIcon}
        />
        <SettingsRow
          href="/profile/notifications"
          label="Notifications"
          sub="What each group can ping you about"
          Icon={BellIcon}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {LINKS.map((l) => (
          <QuickLink key={l.label} href={l.href} label={l.label} Icon={l.Icon} />
        ))}
      </div>

      {/* Solid, and sitting with Sign out rather than among the small-print tiles: it's the one
          destination here that leaves this account's own world entirely. */}
      {isAdmin && (
        <Link
          href="/admin"
          className="flex h-[52px] items-center justify-center gap-2.5 rounded-full bg-espresso-900 text-[14.5px] font-extrabold text-paper-white"
        >
          <ShieldAlertIcon className="h-[18px] w-[18px] text-honey-300" />
          Admin
        </Link>
      )}

      <form action={signOut}>
        <button
          type="submit"
          className="flex h-[50px] w-full items-center justify-center gap-2.5 rounded-full border-[1.5px] border-espresso-200 bg-transparent text-sm font-extrabold text-espresso-700 transition-colors hover:bg-espresso-50"
        >
          <SignOutIcon className="h-[17px] w-[17px]" />
          Sign out
        </button>
      </form>
    </div>
  );

  if (!memberships || memberships.length === 0) {
    return (
      <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
        <PageHeader title="Profile" />
        <EmptyState icon="👥" title="You're not in any groups yet" subtitle="Your record shows up here once you join or start one." />
        <Link href="/groups">
          <Button className="w-full">Go to your groups</Button>
        </Link>
        {accountLinks}
      </main>
    );
  }

  const selected = memberships.find((m) => m.group_id === groupParam) ?? memberships[0];
  const groupId = selected.group_id;
  const groupName = (selected.groups as any)?.name ?? '';

  const switcherGroups = memberships.map((m) => ({
    id: m.group_id,
    name: (m.groups as any)?.name ?? '',
    avatarKey: (m.groups as any)?.avatar_key ?? null,
    handle: m.nickname,
  }));

  // Same rank definition the leaderboard/groups-hub pages use: currently-playing members
  // (active or dormant) sorted by balance descending, rank = array index + 1.
  const { data: groupMembers } = await supabase
    .from('memberships')
    .select('user_id, balance')
    .eq('group_id', groupId)
    .in('status', ['active', 'dormant']);
  const ranked = [...(groupMembers ?? [])].sort((a, b) => b.balance - a.balance);
  const myRankIndex = ranked.findIndex((m) => m.user_id === user!.id);
  const standing = myRankIndex >= 0 ? `${formatOrdinal(myRankIndex + 1)} of ${ranked.length}` : `Sitting out of ${ranked.length}`;

  const { data: myMembership } = await supabase
    .from('memberships')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', user!.id)
    .single();

  // Same "every ledger entry but the seed" net definition the leaderboard's all-time card and
  // the groups hub's per-card net figure both use.
  const { data: ledgerRows } = myMembership
    ? await supabase.from('ledger').select('amount').eq('membership_id', myMembership.id).neq('reason', 'seed')
    : { data: [] };
  const netHere = (ledgerRows ?? []).reduce((sum, r) => sum + r.amount, 0);

  // Same win-rate definition the leaderboard's Accuracy card and The Oracle/Ice Cold titles use
  // (void markets excluded — never 'resolved' with a null outcome).
  const { data: settledBets } = await supabase
    .from('bets')
    .select('side, option_id, markets!inner(group_id, status, outcome, outcome_option_id)')
    .eq('user_id', user!.id)
    .eq('markets.group_id', groupId)
    .eq('markets.status', 'resolved');
  const correctCount = (settledBets ?? []).filter((b: any) =>
    b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome
  ).length;
  const accuracyPct = (settledBets?.length ?? 0) > 0 ? Math.round((correctCount / settledBets!.length) * 100) : null;

  // Card footer. The best call by payout multiple (a genuine profit only — a refund or a loss
  // doesn't count as "best") is the line worth reading, so it gets its own label and the tenure
  // sentence it used to be tacked onto shrinks to a caption under it.
  const { data: myClosedBets } = await supabase
    .from('bets')
    .select('amount, payout, market_id, markets!inner(group_id, title)')
    .eq('user_id', user!.id)
    .eq('markets.group_id', groupId)
    .not('settled_at', 'is', null);
  const settledMarketCount = new Set((myClosedBets ?? []).map((b) => b.market_id)).size;
  let bestCall: { multiple: number; title: string } | null = null;
  for (const b of (myClosedBets ?? []) as any[]) {
    if (!b.payout || b.payout <= b.amount) continue;
    const multiple = b.payout / b.amount;
    if (!bestCall || multiple > bestCall.multiple) bestCall = { multiple, title: b.markets.title };
  }
  const sinceLabel = new Date(selected.joined_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const tenureLine =
    settledMarketCount > 0 ? `Here since ${sinceLabel} · ${settledMarketCount} settled` : `Here since ${sinceLabel}`;

  // Open bets carousel — only open bets: settled results live on the market itself (its reveal
  // ticket), not here. This is the one section of the page that is *not* scoped to the selected
  // group. Everything above it is a per-group figure that would be meaningless aggregated (see the
  // per-group identity rule), but an open bet is a thing you have to come back for, and hiding the
  // ones in your other groups behind a switcher meant the page couldn't answer "what have I got
  // riding?" without four taps. It stays honest by labelling each card with the group it's in
  // rather than merging them into a single anonymous total.
  const allGroupIds = memberships.map((m) => m.group_id);
  const groupNameById = new Map(memberships.map((m) => [m.group_id, (m.groups as any)?.name ?? '']));
  const showGroupLabels = memberships.length > 1;

  const { data: openBetRows } = await supabase
    .from('bets')
    .select('id, side, option_id, amount, market_id, markets!inner(id, group_id, title, market_type, closes_at)')
    .eq('user_id', user!.id)
    .in('markets.group_id', allGroupIds)
    .is('settled_at', null);

  // Soonest to close first — with several groups in one rail, "what closes next" is the only
  // ordering that means anything.
  const openBets = [...((openBetRows ?? []) as any[])].sort(
    (a, b) => new Date(a.markets.closes_at).getTime() - new Date(b.markets.closes_at).getTime()
  );

  const openOptionIds = [...new Set(openBets.map((b) => b.option_id).filter(Boolean))];
  const { data: openOptionRows } =
    openOptionIds.length > 0 ? await supabase.from('market_options').select('id, label').in('id', openOptionIds) : { data: [] };
  const openOptionLabelById = new Map((openOptionRows ?? []).map((o) => [o.id, o.label]));

  // "To win" is a live estimate off the pool as it stands right now, using the same parimutuel
  // formula finalize_market() uses for real — not a promise, since the pool (and so the payout)
  // keeps moving until the market actually closes.
  const openMarketIds = [...new Set(openBets.map((b) => b.market_id))];
  const { data: poolBetRows } =
    openMarketIds.length > 0 ? await supabase.from('bets').select('market_id, side, option_id, amount').in('market_id', openMarketIds) : { data: [] };
  const totalPoolByMarket = new Map<string, number>();
  const sidePoolByKey = new Map<string, number>();
  for (const b of (poolBetRows ?? []) as any[]) {
    totalPoolByMarket.set(b.market_id, (totalPoolByMarket.get(b.market_id) ?? 0) + b.amount);
    const key = `${b.market_id}:${b.side ?? b.option_id}`;
    sidePoolByKey.set(key, (sidePoolByKey.get(key) ?? 0) + b.amount);
  }
  function estimatedToWin(bet: any): number {
    const totalPool = totalPoolByMarket.get(bet.market_id) ?? bet.amount;
    const sidePool = sidePoolByKey.get(`${bet.market_id}:${bet.side ?? bet.option_id}`) ?? bet.amount;
    return Math.floor((bet.amount * totalPool) / sidePool);
  }

  const openCount = openBets.length;

  return (
    <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
      <GroupSwitcher groups={switcherGroups} currentGroupId={groupId} />

      <ShareRecordCard groupName={groupName} handle={selected.nickname}>
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 p-5 text-paper-white">
          <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(circle_at_88%_0%,rgba(232,163,61,0.3),rgba(232,163,61,0)_60%)]" />
          <div className="relative mb-3.5 flex items-center gap-2.5">
            <img src="/barbets-mono-white.png" alt="" width={20} height={20} className="block" />
            <div>
              <p className="text-base font-extrabold italic">@{selected.nickname}</p>
              <p className="text-[10.5px] font-extrabold tracking-[0.09em] text-honey-400 uppercase">Your name at this table</p>
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-x-2.5 gap-y-3.5">
            <div>
              <p className="text-2xl font-extrabold tracking-[-0.02em]">{formatTokens(selected.balance)}</p>
              <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-paper-white/50 uppercase">Tokens</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold tracking-[-0.02em] text-honey-300">{standing}</p>
              <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-paper-white/50 uppercase">Standing</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold tracking-[-0.02em]">{accuracyPct == null ? '—' : `${accuracyPct}%`}</p>
              <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-paper-white/50 uppercase">Accuracy</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold tracking-[-0.02em] text-honey-300">
                {netHere >= 0 ? '+' : '−'}
                {formatTokens(Math.abs(netHere))}
              </p>
              <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-paper-white/50 uppercase">Net here</p>
            </div>
          </div>
          <div className="relative mt-4 border-t border-white/10 pt-3.5">
            <p className="text-[10.5px] font-bold tracking-[0.07em] text-honey-400 uppercase">Best call</p>
            {bestCall ? (
              <p className="mt-1 line-clamp-2 text-[13.5px] leading-[1.35] font-bold text-paper-white">
                {bestCall.multiple.toFixed(1)}&times; on &ldquo;{bestCall.title}&rdquo;
              </p>
            ) : (
              <p className="mt-1 text-[13.5px] leading-[1.35] text-paper-white/50">Nothing settled yet.</p>
            )}
            <p className="mt-1.5 text-[11px] text-paper-white/40">{tenureLine}</p>
          </div>
        </div>
      </ShareRecordCard>

      <div>
        {/* No horizontal padding of its own: the rail below breaks out of the page gutter
            (-mx-5 … px-5), so any inset here would leave the heading a couple of pixels to the
            right of the card edges it is supposed to sit above. */}
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-extrabold tracking-[0.06em] text-espresso-400 uppercase">Still open</h3>
          {openCount > 0 && (
            <span className="shrink-0 text-xs text-espresso-400">
              {openCount} {openCount === 1 ? 'bet' : 'bets'} riding · {showGroupLabels ? 'every table' : 'swipe'}
            </span>
          )}
        </div>
        {openCount === 0 ? (
          <EmptyState icon="🎲" title="Nothing riding right now" subtitle="Bets you've got open show up here." />
        ) : (
          <div
            // scroll-pl-5 matches the px-5: without it, mandatory snapping aligns the first card
            // to the scrollport's border edge and immediately scrolls the padding away, parking
            // every card 20px left of the "Still open" heading above them.
            className="-mx-5 flex scroll-pl-5 gap-2.5 overflow-x-auto px-5 pb-3 [scroll-snap-type:x_mandatory] [scrollbar-width:none]"
          >
            {openBets.map((b: any) => {
              const market = b.markets;
              const sideLabel = (b.option_id ? openOptionLabelById.get(b.option_id) ?? '' : b.side ?? '').toUpperCase();
              return (
                <Link
                  key={b.id}
                  href={`/groups/${market.group_id}/markets/${market.id}`}
                  className="flex w-[calc((100%-10px)/2)] shrink-0 flex-col justify-between gap-3 rounded-[20px] border border-espresso-100 bg-paper-white p-3.5 [scroll-snap-align:start]"
                >
                  <span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center rounded-full bg-espresso-50 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.06em] text-espresso-500 uppercase">
                        {MARKET_TYPE_LABEL[market.market_type as keyof typeof MARKET_TYPE_LABEL]}
                      </span>
                      {showGroupLabels && (
                        <span className="min-w-0 truncate text-[10px] font-extrabold tracking-[0.05em] text-espresso-300 uppercase">
                          {groupNameById.get(market.group_id)}
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block text-balance text-[14.5px] font-bold leading-[1.32] text-espresso-900">{market.title}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2.5 border-t border-espresso-50 pt-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-extrabold text-honey-700">
                        <OptionLabel label={sideLabel} />
                      </span>
                      <span className="mt-0.5 block text-[11px] text-espresso-400">
                        <CountdownTimer target={market.closes_at} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-extrabold text-espresso-900">{formatTokens(estimatedToWin(b))}</span>
                      <span className="mt-0.5 block text-[10px] font-bold tracking-[0.06em] text-espresso-400 uppercase">to win</span>
                    </span>
                  </span>
                </Link>
              );
            })}
            <span className="w-1 shrink-0" />
          </div>
        )}
      </div>

      {accountLinks}
    </main>
  );
}
