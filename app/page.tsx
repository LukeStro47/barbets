import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';
import { InfoIcon } from '@/components/ui/icons';

/**
 * First touch: pick between making an account, signing in, and redeeming an invite code.
 * Deliberately a splash rather than a marketing page — most arrivals are on a friend's invite
 * link and already know what this is, so the screen's whole job is to route them, not to sell.
 *
 * Button hierarchy matches 5a2 exactly (Create an account / Log in, then "Got a group code?" as
 * a plain tertiary link) even though most real arrivals are actually on an invite link, not a
 * cold signup — that was the reasoning behind the previous version's hierarchy, which put the
 * invite-code path on equal footing with signup and demoted sign-in to a text link. Matching the
 * design's own hierarchy here on purpose, since a cold link (`/join/[code]`) already routes a
 * signed-out invitee through account creation directly without ever landing on this screen at
 * all — this splash is mainly for the "open the app cold" case, where create/log-in genuinely
 * are the two real choices.
 *
 * "How it works" moved out of the button stack and into the corner pill: as a third full-width
 * button it competed with the two real actions for the same glance, and it's the one thing here
 * nobody needs in order to proceed.
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/groups');

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-canvas px-6 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
      <div
        aria-hidden
        className="animate-splash-glow pointer-events-none absolute top-[120px] left-1/2 -ml-[210px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(45,85,245,0.35)_0%,rgba(45,85,245,0)_68%)]"
      />

      <Link
        href="/how-it-works"
        className="absolute top-[calc(env(safe-area-inset-top)+1.5rem)] right-5 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface py-2 pr-3.5 pl-3 text-[13px] font-semibold whitespace-nowrap text-muted"
      >
        <InfoIcon className="h-[15px] w-[15px] text-signal-deep" />
        How it works
      </Link>

      <div className="animate-splash-rise relative flex flex-col items-center">
        <StackedLogo height={190} />
        <h1 className="mt-[26px] max-w-[320px] font-display text-[26px]/[30px] font-extrabold tracking-[-0.02em] text-pretty text-ink">
          Bet on your friends, and everything else.
        </h1>
        <p className="mt-3.5 max-w-[290px] text-base/[23px] text-muted">
          Private prediction markets about anything. Play money, real odds.
        </p>
      </div>

      <div className="relative mt-11 flex w-full max-w-[330px] flex-col gap-3">
        <Link href="/login?mode=signup" className="w-full">
          <Button variant="accent" size="xl" className="w-full">
            Create an account
          </Button>
        </Link>
        <Link href="/login" className="w-full">
          <Button variant="outline" size="xl" className="w-full">
            Log in
          </Button>
        </Link>
      </div>

      <Link href="/join" className="relative mt-[18px] text-base font-semibold text-muted">
        Got a group code?
      </Link>
    </main>
  );
}
