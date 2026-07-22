import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';

const sections = [
  {
    title: 'What we collect',
    body: 'Your email and password (for signing in), a nickname per group you join, and your betting/group activity within Barbets: bets placed, markets created, group memberships, and the resulting token balances. All of it is functional data needed to run the app, not collected for advertising.',
  },
  {
    title: 'Push notifications',
    body: "If you turn on notifications, we store a device token (a push subscription on the web, or an FCM token in the native app) so we can send you alerts about markets that need you. Native app notifications are delivered through Google's Firebase Cloud Messaging. You can turn this off any time from your Profile page.",
  },
  {
    title: "What we don't do",
    body: "No ads, no ad tracking, no analytics or tracking SDKs of any kind, and we never sell or share your data with third parties for marketing. Barbets never involves real money — tokens have no cash value and can't be bought, sold, or withdrawn.",
  },
  {
    title: 'Who processes your data',
    body: 'Supabase hosts our database, authentication, and file storage. Vercel hosts the web app. Google (Firebase) delivers push notifications to the native app. None of them use your data for anything beyond running Barbets on our behalf.',
  },
  {
    title: 'Privacy inside the app',
    body: "Barbets' whole point is that a market can be about you without you being able to see it exists until it resolves. That privacy model governs what other members of your groups can see about you inside the app — it's separate from, and in addition to, this policy.",
  },
  {
    title: 'Deleting your account',
    body: "You can permanently delete your account from the Profile page at any time. This removes your account and personal data; markets you're involved in are handled the same way they are when anyone leaves a group.",
  },
  {
    title: "Children's privacy",
    body: 'Barbets is not directed at children and we do not knowingly collect data from anyone under 13.',
  },
  {
    title: 'Changes to this policy',
    body: "If this policy changes in a way that matters, we'll update this page. Continued use of Barbets after a change means you accept the update.",
  },
];

export default async function PrivacyPage() {
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
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Privacy policy</h1>
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
        Questions about this policy or your data? Reach out at{' '}
        <a href="mailto:luke@pathwell.co" className="font-medium text-espresso-700 underline">
          luke@pathwell.co
        </a>
        .
      </p>
    </main>
  );
}
