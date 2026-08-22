import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { BackButton } from '@/components/ui/BackButton';
import { Mention } from '@/components/ui/Mention';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import { formatSeasonLength, type SeasonLength } from '@/lib/seasonLength';
import { CONTACT_EMAIL } from '@/lib/appOrigin';

type Tab = 'basics' | 'your-group' | 'edge-cases';

function windowLabel(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const cardClasses = 'overflow-hidden rounded-2xl border border-espresso-100 bg-paper-white shadow-sm shadow-espresso-900/5';
const ruleTitleClasses = 'block font-display text-[15.5px] font-extrabold tracking-[-0.01em] text-espresso-950';
const ruleBodyClasses = 'mt-1 block text-[13.5px] leading-[1.55] text-espresso-600';

/** A row title's paired value, read live from the group whose settings this page was opened from. */
function ValuePill({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'neutral' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold',
        tone === 'amber' ? 'border border-honey-300 bg-honey-50 text-honey-800' : 'bg-espresso-50 text-espresso-600'
      )}
    >
      {children}
    </span>
  );
}

function ExplainerRow({ title, pill, children }: { title: string; pill?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-[18px] py-4">
      {pill ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[15px] font-extrabold tracking-[-0.01em] text-espresso-950">{title}</span>
          {pill}
        </div>
      ) : (
        <span className="font-display text-[15px] font-extrabold tracking-[-0.01em] text-espresso-950">{title}</span>
      )}
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-espresso-600">{children}</p>
    </div>
  );
}

export default async function HowItWorksPage({ searchParams }: { searchParams: Promise<{ group?: string; tab?: string }> }) {
  const { group: groupId, tab: rawTab } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only populated when linked from a specific group (e.g. its settings page) — RLS already scopes
  // group_settings reads to members, so a non-member groupId just comes back empty and the page
  // silently falls back to the generic defaults below.
  const [{ data: settings }, { data: group }] = groupId
    ? await Promise.all([
        supabase
          .from('group_settings')
          .select('allow_hedged_bets, require_endorsement, resolution_window_hours, seasons_enabled, season_length, distribute_payout, creator_payout_pct, seed_amount')
          .eq('group_id', groupId)
          .maybeSingle(),
        supabase.from('groups').select('name, owner_id').eq('id', groupId).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  const { data: ownerMembership } = group
    ? await supabase.from('memberships').select('nickname').eq('group_id', groupId!).eq('user_id', group.owner_id).maybeSingle()
    : { data: null };

  const hasGroup = !!settings && !!group;
  // The "Your group" tab reads live settings, so it only exists when there's a group in context.
  const tab: Tab = rawTab === 'your-group' && hasGroup ? 'your-group' : rawTab === 'edge-cases' ? 'edge-cases' : 'basics';

  const window = windowLabel(settings?.resolution_window_hours ?? 8);
  const hedgingAllowed = settings?.allow_hedged_bets ?? true;
  const endorsementRequired = settings?.require_endorsement ?? true;
  const seasonsEnabled = settings?.seasons_enabled ?? false;
  const distributePayout = settings?.distribute_payout ?? false;
  const seedAmount = settings?.seed_amount ?? 1000;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'basics', label: 'The basics' },
    ...(hasGroup ? ([{ key: 'your-group' as Tab, label: 'Your group' }]) : []),
    { key: 'edge-cases', label: 'Edge cases' },
  ];
  const tabHref = (key: Tab) => `/how-it-works?${new URLSearchParams({ ...(groupId ? { group: groupId } : {}), tab: key })}`;

  const basics = [
    {
      title: 'Bets are sealed until the market closes',
      body: "While it's open nobody sees who bet what, not even you, for anyone else. Just a running total. At close the pool splits into a percentage per side; individual bets stay hidden until it resolves.",
    },
    {
      title: 'Winners split the losing pool',
      body: "Parimutuel, so there's no house. Everything staked on the losing side is divided among the winners in proportion to what each of them put in, and your own stake comes back on top.",
    },
    {
      title: 'Everyone starts even, and stays capped',
      body: `Every member is seeded ${formatTokens(seedAmount)} on joining${seasonsEnabled ? ', and again at each new season' : ''}. There's no way to buy more, your stake is your stake.`,
    },
    {
      title: 'The group settles its own bets',
      body: `Anyone eligible calls what happened. If nobody disputes it inside the ${window} challenge window, it stands. If someone does, the group votes by secret ballot.`,
    },
  ];

  const lifecycle = [
    { dot: 'bg-espresso-900', label: 'Open', body: 'Bets are sealed. Nobody sees who bet what.' },
    { dot: 'bg-espresso-900', label: 'Closed', body: 'Odds appear as a percentage split. Individual bets stay hidden.' },
    { dot: 'bg-honey-500', label: 'Proposed', body: `Someone says what happened. ${window} to challenge it.` },
    { dot: 'bg-espresso-200', label: 'Challenged', body: 'Someone disagreed. The group votes by secret ballot instead.' },
    { dot: 'bg-success-500', label: 'Resolved', body: 'Winners split the losing pool. Every bet becomes visible.' },
  ];

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-[26px] px-5 py-9 pt-[calc(env(safe-area-inset-top)+2.25rem)]">
      <div className="flex items-center justify-between">
        <BackButton
          fallbackHref={groupId ? `/groups/${groupId}/settings` : user ? '/groups' : '/'}
          label={groupId ? 'Settings' : 'Back'}
        />
        <Logo height={26} />
      </div>

      <div>
        <h1 className="font-display text-[27px] font-extrabold tracking-[-0.025em] text-espresso-950">How Barbets works</h1>
        <p className="mt-1.5 text-[14.5px] leading-[1.5] text-espresso-500">
          Three minutes of house rules. Nobody is a bookmaker; the group settles its own bets.
        </p>
      </div>

      <div className="flex gap-1.5 rounded-full bg-espresso-50 p-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            scroll={false}
            replace
            className={cn(
              'flex-1 rounded-full px-1.5 py-2 text-center text-[12.5px]',
              tab === t.key ? 'bg-paper-white font-bold text-espresso-950 shadow-sm' : 'font-semibold text-espresso-400'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'basics' && (
        <>
          <div className={`${cardClasses} [&>*+*]:border-t [&>*+*]:border-espresso-100`}>
            {basics.map((b, i) => (
              <div key={b.title} className="flex items-start gap-3.5 px-[18px] py-4">
                <span className="w-5 shrink-0 pt-[3px] text-[11px] font-extrabold text-espresso-300">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>
                  <span className={ruleTitleClasses}>{b.title}</span>
                  <span className={ruleBodyClasses}>{b.body}</span>
                </span>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-3 px-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-espresso-400">
              A market&apos;s life
            </p>
            {/* A static timeline, not the old auto-advancing carousel: five stages that only make
                sense in order shouldn't need four taps (or a timer) to be read as an order. */}
            <div className={`${cardClasses} p-[18px]`}>
              <ol className="flex flex-col gap-[17px]">
                {lifecycle.map((s, i) => (
                  <li key={s.label} className="flex gap-3.5">
                    <span className="relative flex w-[11px] shrink-0 flex-col items-center">
                      <span className={cn('relative z-10 mt-[5px] h-[11px] w-[11px] rounded-full', s.dot)} />
                      {i < lifecycle.length - 1 && <span className="absolute top-[10px] h-full w-0.5 bg-espresso-100" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-[13.5px] font-extrabold text-espresso-950">{s.label}</span>
                      <span className="mt-px block text-[12.5px] leading-[1.45] text-espresso-500">{s.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}

      {tab === 'your-group' && settings && group && (
        <>
          <p className="px-0.5 text-[13.5px] leading-[1.55] text-espresso-600">
            The settings below are the ones{' '}
            {ownerMembership?.nickname ? (
              <Mention nickname={ownerMembership.nickname} className="font-bold" />
            ) : (
              'the owner'
            )}{' '}
            has chosen for {group.name}. Every group answers them differently.
          </p>

          <div className={`${cardClasses} [&>*+*]:border-t [&>*+*]:border-espresso-100`}>
            <ExplainerRow
              title="Endorsement"
              pill={<ValuePill tone={endorsementRequired ? 'amber' : 'neutral'}>{endorsementRequired ? 'Required' : 'Not needed'}</ValuePill>}
            >
              {endorsementRequired
                ? "A market needs two people: whoever writes it, and a different member who endorses it. Until then it's not visible to bet on, and it expires after 24 hours with nobody backing it."
                : 'A market opens for betting the moment it\'s written, with no second person involved. Groups that turn this on do so because a second pair of eyes catches an unfair or unclear question before anyone stakes on it.'}
            </ExplainerRow>
            <ExplainerRow
              title="Hedging"
              pill={<ValuePill tone={hedgingAllowed ? 'amber' : 'neutral'}>{hedgingAllowed ? 'Allowed' : 'One side only'}</ValuePill>}
            >
              {hedgingAllowed
                ? 'You can hold bets on more than one side of the same market. Groups that turn this off do so because a big bet on the favourite plus a token bet on the underdog is a way to win either way.'
                : 'You hold one side per market. Adding more to that same side is still fine, so you can top up a position, just not cover both outcomes.'}
            </ExplainerRow>
            <ExplainerRow title="Challenge window" pill={<ValuePill tone="amber">{window}</ValuePill>}>
              Once a result is called you have {window} to challenge it. If you do, the vote also runs for {window}, or ends
              early the moment everyone eligible has voted. A tie upholds the call.
            </ExplainerRow>
            <ExplainerRow
              title="Nobody calls it right"
              pill={<ValuePill tone={distributePayout ? 'amber' : 'neutral'}>{distributePayout ? 'Split' : 'Refunded'}</ValuePill>}
            >
              {distributePayout
                ? `When the outcome that happened had no bets on it, the market's creator takes ${settings.creator_payout_pct}% and the rest tops up the group's other open markets. Most groups instead refund every stake.`
                : 'When the outcome that happened had no bets on it, every stake goes back. Some groups instead pay the market\'s creator a cut and roll the rest into their other open markets.'}
            </ExplainerRow>
            <ExplainerRow
              title="Seasons"
              pill={
                <ValuePill tone={seasonsEnabled ? 'amber' : 'neutral'}>
                  {seasonsEnabled
                    ? settings.season_length === 'manual'
                      ? 'When the owner ends it'
                      : settings.season_length === 'custom'
                        ? 'On a set date'
                        : `Every ${formatSeasonLength((settings.season_length ?? '3m') as SeasonLength)}`
                    : 'Off'}
                </ValuePill>
              }
            >
              {seasonsEnabled
                ? `At the end of a season standings are archived to Awards and everyone is reseeded to ${formatTokens(seedAmount)}. Betting reopens once the owner starts the next one.`
                : 'This group has no seasons, so the board never resets and one running total carries forever. Groups that turn seasons on get a periodic fresh start and an Awards archive of each run.'}
            </ExplainerRow>
          </div>
        </>
      )}

      {tab === 'edge-cases' && (
        <div className={`${cardClasses} [&>*+*]:border-t [&>*+*]:border-espresso-100`}>
          <ExplainerRow title="Markets about you are invisible to you">
            If a market @mentions you, you won&apos;t see that it exists anywhere until it resolves. Then you see everything,
            including who bet what.
          </ExplainerRow>
          <ExplainerRow title="Leaving">
            Any market about you is voided and refunded. Your other open bets stay in play and settle without you. You
            aren&apos;t reseeded if you come back.
          </ExplainerRow>
          <ExplainerRow title="Being removed">
            Permanent, and the invite code rotates the moment it happens, so the old link stops working.
          </ExplainerRow>
          <ExplainerRow title="A market nobody bet on">
            If closing time arrives with no bets at all, it&apos;s voided outright. Nothing to settle, nothing to refund.
          </ExplainerRow>
          <ExplainerRow title="The group being deleted">
            Every open market is voided and refunded first. If the owner does it, it&apos;s immediate and there&apos;s no undo.
          </ExplainerRow>
          <ExplainerRow title="A group nobody's touched">
            No market and no bet in 90 days gets a 14-day warning, with reminders at 7 days and the day before. Anyone can
            start a market or place a bet to stay clear of it; once it&apos;s scheduled, only the owner can call it off.
          </ExplainerRow>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Link href="/demo" className="text-[13.5px] font-semibold text-espresso-700">
          Prefer to see it in action? Try the interactive demo
        </Link>
        {/* A mailto rather than /feedback: this page is public, and /feedback lives behind the
            app's auth gate, so a logged-out reader would just get bounced to the login screen. */}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-[13.5px] font-semibold text-espresso-700">
          Questions? Email us
        </a>
        <div className="mt-0.5 flex gap-3.5">
          <Link href="/terms" className="text-[12.5px] text-espresso-400">
            Terms of use
          </Link>
          <Link href="/privacy" className="text-[12.5px] text-espresso-400">
            Privacy policy
          </Link>
        </div>
      </div>
    </main>
  );
}
