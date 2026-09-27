import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Wordmark } from '@/components/ui/BrandMark';

/**
 * 5a2: the signed-out front door. The wordmark, the pitch, a sample market drawn exactly like a
 * real one (an illustration, not live data — nobody signed out may see a real group's markets),
 * the two rules that make barbets different, then Create an account / Log in / Got a group code?
 * A cold invite link never lands here (/join/[code] has its own preview, 5o).
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/groups');

  return (
    <main className="mx-auto min-h-dvh max-w-[430px] bg-canvas px-[22px] pt-[calc(env(safe-area-inset-top)+58px)] pb-[200px]">
      <Wordmark size={22} />

      <h1 className="mt-[26px] text-[34px] leading-[1.08] font-extrabold tracking-[-0.032em] text-ink text-pretty">Settle it properly.</h1>
      <p className="mt-3 text-[15px] leading-[1.5] text-muted text-pretty">
        Your group, your arguments, on the record. Play credits. There is no cash in barbets and never will be.
      </p>

      <div aria-hidden className="mt-[26px] overflow-hidden rounded-[22px] border border-hairline bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
        <div className="flex items-center gap-[9px] px-4 pt-[13px]">
          <img src="/avatars/beer.png" alt="" className="h-5 w-5 rounded-full object-cover" />
          <span className="text-[11.5px] font-bold text-faint">Wednesday Wagers</span>
          <span className="ml-auto font-mono text-[11.5px] font-semibold text-signal">2h 15m</span>
        </div>
        <p className="px-4 pt-[9px] pb-[13px] text-[18px] leading-[1.28] font-bold tracking-[-0.015em] text-ink text-pretty">Will Jake finish the marathon?</p>
        <div className="flex gap-2 px-4 pb-3.5">
          <span className="flex-1 rounded-xl bg-ink py-[11px] text-center text-[14px] font-bold text-surface">Yes</span>
          <span className="flex-1 rounded-xl border border-hairline bg-tile py-[11px] text-center text-[14px] font-bold text-muted">No</span>
        </div>
        <div className="flex items-center gap-[9px] border-t border-rule px-4 py-[11px] font-mono text-[12px] text-faint">
          <span className="font-semibold text-ink">1,240</span>
          <span>pooled</span>
          <span className="h-[3px] w-[3px] rounded-full bg-dash" />
          <span className="font-semibold text-ink">7</span>
          <span>in</span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-[11px]">
        {[
          ['No odds while it’s open.', 'The pool sets the price when betting shuts.'],
          ['You call the results', 'between you, no house, no referee.'],
        ].map(([lead, rest]) => (
          <div key={lead} className="flex gap-[11px]">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-signal-tint text-signal">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M2 6.3 4.6 9 10 3.2" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-[1.45] text-muted text-pretty">
              <span className="font-bold text-ink">{lead}</span> {rest}
            </span>
          </div>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/[0.96] px-[18px] pt-3 pb-[max(28px,env(safe-area-inset-bottom))] backdrop-blur-[8px]">
        <div className="mx-auto flex max-w-[430px] flex-col gap-[9px]">
          <Link href="/login?mode=signup" className="block rounded-[14px] bg-signal py-[15px] text-center text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)]">
            Create an account
          </Link>
          <Link href="/login" className="block rounded-[14px] border border-hairline bg-surface py-[14px] text-center text-[15px] font-bold text-ink">
            Log in
          </Link>
          <Link href="/join" className="pt-0.5 text-center text-[13px] font-semibold text-faint">
            Got a group code?
          </Link>
        </div>
      </div>
    </main>
  );
}
