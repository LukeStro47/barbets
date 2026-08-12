import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';
import { InfoIcon } from '@/components/ui/icons';

/**
 * First touch: pick between making an account, redeeming an invite, and signing in. Deliberately
 * a splash rather than a marketing page — most arrivals are on a friend's invite link and already
 * know what this is, so the screen's whole job is to route them, not to sell.
 *
 * "How it works" moved out of the button stack and into the corner pill: as the third full-width
 * button it competed with Sign in for the same glance, and it's the one thing here nobody needs
 * in order to proceed.
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/groups');

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-paper px-6 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
      <div
        aria-hidden
        className="animate-splash-glow pointer-events-none absolute top-[120px] left-1/2 -ml-[210px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(232,163,61,0.35)_0%,rgba(232,163,61,0)_68%)]"
      />

      <Link
        href="/how-it-works"
        className="absolute top-[calc(env(safe-area-inset-top)+1.5rem)] right-5 inline-flex items-center gap-1.5 rounded-full border border-espresso-100 bg-paper-white py-2 pr-3.5 pl-3 text-[13px] font-semibold whitespace-nowrap text-espresso-700"
      >
        <InfoIcon className="h-[15px] w-[15px] text-honey-700" />
        How it works
      </Link>

      <div className="animate-splash-rise relative flex flex-col items-center">
        <StackedLogo height={190} />
        <h1 className="mt-[26px] max-w-[320px] font-display text-[26px]/[30px] font-extrabold tracking-[-0.02em] text-pretty text-espresso-900">
          Bet on your friends, and everything else.
        </h1>
        <p className="mt-3.5 max-w-[290px] text-base/[23px] text-espresso-500">
          Private prediction markets about anything. Play money, real odds.
        </p>
      </div>

      <div className="relative mt-11 flex w-full max-w-[330px] flex-col gap-3">
        <Link href="/login?mode=signup" className="w-full">
          <Button
            variant="accent"
            size="xl"
            className="w-full shadow-[0_8px_22px_-10px_rgba(172,111,24,0.5)]"
          >
            Start betting
          </Button>
        </Link>
        <Link
          href="/join"
          className="w-full rounded-full border border-espresso-200 px-6 py-[15px] text-base font-semibold text-espresso-900"
        >
          I have an invite code
        </Link>
      </div>

      <div className="relative mt-[26px] flex w-full max-w-[330px] items-center gap-2.5">
        <span className="h-px flex-1 bg-espresso-100" />
        <span className="text-base text-espresso-500">
          Been here before?{' '}
          <Link href="/login" className="font-bold text-espresso-900 underline underline-offset-4">
            Sign in
          </Link>
        </span>
        <span className="h-px flex-1 bg-espresso-100" />
      </div>
    </main>
  );
}
