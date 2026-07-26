import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';

const sections = [
  {
    title: 'Play money only',
    body: "Barbets is a play-money prediction market for private friend groups. Tokens have no cash value, can't be bought, sold, or withdrawn, and no real money ever changes hands. Barbets is not gambling and is not a financial product.",
  },
  {
    title: 'Eligibility',
    body: 'You must be at least 13 years old to use Barbets, and old enough in your own jurisdiction to enter into these terms.',
  },
  {
    title: 'No abusive content or conduct',
    body: "Don't post or send anything harassing, threatening, hateful, sexually explicit, illegal, or otherwise abusive, whether in a market title, description, nickname, resolution justification, or photo. This applies to everyone in your group, including anyone a market is about. Violating this is grounds for removal from a group or termination of your account.",
  },
  {
    title: 'Group owners moderate their own groups',
    body: "Each group's owner can remove any member at any time, for any reason, and rotate the invite code so a removed member can't rejoin. If someone in your group is being abusive, the fastest fix is for the owner to remove them.",
  },
  {
    title: 'Reporting a problem',
    body: 'To report abusive content or behavior we should know about, email luke@pathwell.co. We review every report and can remove content, suspend a group, or terminate an account in response.',
  },
  {
    title: "You own your content, and you're responsible for it",
    body: "You retain ownership of what you post. You're solely responsible for it, and for making sure it doesn't violate these terms or the law. We can remove content or terminate accounts that violate these terms, with or without notice.",
  },
  {
    title: 'No warranty',
    body: "Barbets is provided as-is, without warranties of any kind. We don't guarantee the app will be uninterrupted, error-free, or available forever.",
  },
  {
    title: 'Changes to these terms',
    body: "If these terms change in a way that matters, we'll update this page. Continued use of Barbets after a change means you accept the update.",
  },
];

export default async function TermsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg space-y-8 px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
      <div className="flex items-center justify-between">
        <BackButton fallbackHref={user ? '/groups' : '/'} />
        <Logo />
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Terms of use</h1>
        <p className="mt-1 text-espresso-500">Last updated July 2026.</p>
      </div>

      <div className="space-y-4">
        {sections.map((s) => (
          <Card key={s.title}>
            <h2 className="font-display font-bold text-espresso-800">{s.title}</h2>
            <p className="mt-1 text-espresso-600">{s.body}</p>
          </Card>
        ))}
      </div>

      <p className="text-sm text-espresso-500">
        Questions about these terms? Reach out at{' '}
        <a href="mailto:luke@pathwell.co" className="font-medium text-espresso-700 underline">
          luke@pathwell.co
        </a>
        .
      </p>
    </main>
  );
}
