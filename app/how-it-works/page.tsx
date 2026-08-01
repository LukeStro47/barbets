import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';
import { LifecycleSlideshow, type LifecycleStep } from '@/components/ui/LifecycleSlideshow';

function windowLabel(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export default async function HowItWorksPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only populated when linked from a specific group (e.g. its settings page) — RLS already scopes
  // group_settings reads to members, so a non-member groupId just comes back empty and the page
  // silently falls back to the generic defaults below.
  const { data: settings } = groupId
    ? await supabase
        .from('group_settings')
        .select('allow_hedged_bets, require_endorsement, resolution_window_hours, seasons_enabled, distribute_payout')
        .eq('group_id', groupId)
        .maybeSingle()
    : { data: null };

  const window = windowLabel(settings?.resolution_window_hours ?? 8);
  const hedgingAllowed = settings?.allow_hedged_bets ?? true;
  const endorsementRequired = settings?.require_endorsement ?? true;
  const seasonsEnabled = settings?.seasons_enabled ?? false;
  const distributePayout = settings?.distribute_payout ?? false;

  const lifecycle: LifecycleStep[] = [
    { icon: '🔒', label: 'Open', body: 'Bets are sealed. Nobody sees who bet what, not even you, for anyone else.' },
    { icon: '📊', label: 'Closed', body: 'Odds appear as a percentage split. Individual bets stay hidden.' },
    { icon: '🗳️', label: 'Proposed', body: `Someone says what happened. ${window} to challenge it.` },
    { icon: '⚖️', label: 'Challenged', body: 'Someone disagreed. The group votes by secret ballot instead.' },
    { icon: '🏁', label: 'Resolved', body: 'Winners split the losing pool. Every bet becomes visible.' },
  ];

  const sections = [
    {
      icon: '🙈',
      title: 'Bets are sealed, odds appear once closed',
      body: "While a market's open, nobody, including you, sees who bet what or how much, just a running total. The moment it closes, the pool splits into a percentage per side, still no individual bets until it resolves.",
    },
    {
      icon: '💰',
      title: 'Payouts are parimutuel',
      body: `There's no bookmaker. Everyone on the losing side has their stake split among the winners, proportional to how much each staked, your own stake comes back too.${
        distributePayout
          ? " If nobody predicted the outcome, this group sends part of that pool to the creator and endorser and carries the rest into another open market, rather than a plain refund."
          : ''
      }`,
    },
    {
      icon: '🎯',
      title: 'Starting a market',
      body: `Anyone can propose one: Yes/No, Over/Under against a line, or Multiple Choice across 2 to 10 named options.${
        endorsementRequired
          ? ' Another member has to endorse it before betting opens.'
          : ' This group has endorsement turned off, so it opens for betting right away.'
      }${hedgingAllowed ? ' Hedging across more than one side or option is allowed.' : ' This group has hedging turned off, one side or option per person.'}`,
    },
    {
      icon: '⚖️',
      title: 'Resolution is decided by the group',
      body: `Once a market closes (or someone proposes early, which locks betting immediately), any eligible member says what happened. Nobody disagrees within ${window}, it stands. Someone challenges it, the group votes by secret ballot. A tie or no votes upholds the proposal; a tie that excludes it voids instead.`,
    },
    {
      icon: '👤',
      title: 'Markets about you are invisible to you',
      body: "If a market @mentions you, you won't see it exists, anywhere, until it resolves. Then you see everything, including who bet what.",
    },
    seasonsEnabled
      ? {
          icon: '🔄',
          title: 'Seasons reset the board',
          body: "This group resets on a schedule. When a season ends, standings are archived to the Awards and everyone gets reseeded for the next one.",
        }
      : {
          icon: '🚪',
          title: 'Leaving a group',
          body: "Leaving voids and refunds any market about you, but your other open bets stay in play and settle without you. Being removed by the owner is permanent.",
        },
  ];

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="flex items-center justify-between">
        <BackButton fallbackHref={groupId ? `/groups/${groupId}/settings` : user ? '/groups' : '/'} />
        <Logo />
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">How Barbets works</h1>
        <p className="mt-1 text-espresso-500">The house rules, in plain English.</p>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-espresso-400">A market's life</h2>
        <LifecycleSlideshow steps={lifecycle} />
      </div>

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-espresso-400">The full rules</h2>
        <div className="space-y-4">
          {sections.map((s) => (
            <Card key={s.title}>
              <h2 className="flex items-center gap-2 font-display font-bold text-espresso-800">
                <span className="text-lg leading-none">{s.icon}</span>
                {s.title}
              </h2>
              <p className="mt-1 text-espresso-600">{s.body}</p>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <Link href="/help" className="font-medium text-espresso-700 underline">
          Help
        </Link>
        <Link href="/terms" className="font-medium text-espresso-700 underline">
          Terms of use
        </Link>
        <Link href="/privacy" className="font-medium text-espresso-700 underline">
          Privacy policy
        </Link>
      </div>
    </main>
  );
}
