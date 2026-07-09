import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';

const sections = [
  {
    title: 'Bets are sealed while a market is open',
    body: "While betting is open, nobody, including you, can see who else has bet, which side they took, or how much. You'll only see your own bets and a running total count of bets placed.",
  },
  {
    title: 'Odds appear once betting closes',
    body: 'The moment a market closes, the pool splits into a percentage for each side so everyone can see how it leans. Individual bets stay hidden until the market resolves.',
  },
  {
    title: 'Payouts are parimutuel',
    body: "There's no bookmaker setting odds. Everyone who bet on the losing side has their stake split among the winners, proportional to how much each winner staked. Your own stake comes back too.",
  },
  {
    title: 'Three market types',
    body: "Yes/No, Over/Under (against a line), and Multiple Choice: one pool split across 2 to 10 named options instead of two sides, e.g. \"who's first to leave the party?\" You can hedge by betting on more than one option if you want. Whichever type, the pool works the same way: bet on the loser and your stake splits among whoever bet on the winner.",
  },
  {
    title: 'Resolution is decided by the group',
    body: "Once a market closes, any eligible member proposes what happened. If nobody disagrees within 24 hours, it stands. If someone challenges it, the group votes by secret ballot, and ballots are revealed once voting ends. If nobody votes, or the vote ties with the original proposal among the leaders, the proposal stands rather than voiding. A tie that doesn't include the proposal still voids, so challenging only pays off if the group actually rallies behind a different answer.",
  },
  {
    title: 'You can propose the outcome early',
    body: "If the real-world outcome is already known before a market's closing time, any eligible member can propose it right away instead of waiting. This locks betting for everyone immediately and starts the normal 24-hour challenge window. If you think the event genuinely hasn't happened yet, vote VOID rather than picking a side.",
  },
  {
    title: 'Markets about you are invisible to you',
    body: "If a market @mentions you, you won't see it exists: not in your feed, not in counts, not in notifications, nothing, until it resolves. Then you see everything, including who bet what. On a Multiple Choice market, being @mentioned under just one option still hides the whole market, since seeing any option would give it away.",
  },
  {
    title: 'Seasons, if your group wants them',
    body: 'A group can run one continuous economy forever, or reset on a schedule. When a season ends, standings are archived to the Hall of Fame and everyone gets reseeded for the next one.',
  },
  {
    title: 'Leaving a group',
    body: "Leaving voids and refunds any market about you, but your other open bets stay in play and settle without you. You won't be reseeded if you come back later, your balance just picks up where it left off. Being removed by the owner is permanent, and rotates the group's invite code.",
  },
];

export default async function HowItWorksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-10">
      <div className="flex items-center justify-between">
        <BackButton fallbackHref={user ? '/groups' : '/'} />
        <Logo />
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">How Barbets works</h1>
        <p className="mt-1 text-espresso-500">The house rules, in plain English.</p>
      </div>

      <div className="space-y-4">
        {sections.map((s) => (
          <Card key={s.title}>
            <h2 className="font-display font-bold text-espresso-800">{s.title}</h2>
            <p className="mt-1 text-espresso-600">{s.body}</p>
          </Card>
        ))}
      </div>
    </main>
  );
}
