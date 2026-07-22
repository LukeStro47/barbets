import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/ui/Logo';
import { Card } from '@/components/ui/Card';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';

export default async function HelpPage() {
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
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Help</h1>
        <p className="mt-1 text-espresso-500">Questions, bugs, or anything else, we're happy to help.</p>
      </div>

      <Card className="space-y-3">
        <p className="text-espresso-600">
          Email us directly and we'll get back to you.
        </p>
        <a href="mailto:luke@pathwell.co">
          <Button className="w-full">Email luke@pathwell.co</Button>
        </a>
      </Card>

      <div className="flex flex-col gap-2 text-sm">
        <a href="/how-it-works" className="font-medium text-espresso-700 underline">
          How Barbets works
        </a>
        <a href="/privacy" className="font-medium text-espresso-700 underline">
          Privacy policy
        </a>
      </div>
    </main>
  );
}
