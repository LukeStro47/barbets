import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import type { DemoOutcome, DemoSide } from '@/lib/demoScenario';

/**
 * A trimmed, static clone of the real reveal ticket
 * (components/markets/RevealTicket.tsx) — same visual language, but no
 * ReactionBar/ResolutionProofButton/image-capture-and-share, since those are
 * tightly coupled to real Supabase data and orthogonal to what this demos.
 */
export function DemoRevealCard({
  question,
  side,
  outcome,
  payoutLabel,
  barsRevealed,
}: {
  question: string;
  side: DemoSide;
  outcome: DemoOutcome;
  payoutLabel: string;
  barsRevealed: boolean;
}) {
  const headline = side.toUpperCase();
  const odds =
    side === 'yes'
      ? [{ label: 'YES', percent: outcome.yesPercent }, { label: 'NO', percent: outcome.noPercent }]
      : [{ label: 'NO', percent: outcome.noPercent }, { label: 'YES', percent: outcome.yesPercent }];

  return (
    <div
      className="animate-demo-fade-up-scale relative overflow-visible rounded-[28px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 text-paper-white shadow-lg shadow-espresso-950/25"
    >
      <div className="px-6 pt-6 pb-[18px]">
        <div className="mb-3.5 flex items-center gap-[7px]">
          <img src="/barbets-mono-white.png" alt="" width={18} height={18} className="block" />
          <span className="text-xs font-extrabold tracking-[0.08em] text-honey-300 uppercase">Barbets</span>
        </div>

        <p className="mb-1.5 text-[11px] font-bold tracking-[0.1em] text-honey-400 uppercase">Demo &middot; Resolved</p>
        <p className="mb-1.5 text-[15px] font-extrabold text-honey-300">You won {payoutLabel} tokens!</p>
        <p className="mb-4 max-w-[88%] text-[22px] leading-[1.2] font-extrabold tracking-[-0.01em]">{question}</p>

        <div className="flex items-center gap-3.5">
          <div className="flex h-[68px] w-[68px] shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-espresso-950/20 bg-honey-500 text-center text-lg leading-[1.1] font-extrabold uppercase text-espresso-950 shadow-[0_8px_18px_-6px_rgba(232,163,61,0.55)]">
            {headline}
          </div>
          <p className="text-[13px] leading-[1.45] text-paper-white/70">You bet on {headline} and it happened.</p>
        </div>
      </div>

      <div className="relative border-t-2 border-dashed border-white/20">
        <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
        <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
      </div>

      <div className="px-6 pt-[18px] pb-[22px]">
        <p className="mb-2.5 text-[11px] font-bold tracking-[0.1em] text-honey-400 uppercase">Odds at close</p>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-extrabold text-honey-300">
            {odds[0].label} {odds[0].percent}%
          </span>
          <span className="text-[13px] font-extrabold text-paper-white/50">
            {odds[1].label} {odds[1].percent}%
          </span>
        </div>
        <div className="mb-[18px] flex h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-honey-500 transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: `${barsRevealed ? odds[0].percent : 0}%` }}
          />
          <div
            className="h-full bg-white/15 transition-[width] duration-[900ms] delay-[50ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: `${barsRevealed ? odds[1].percent : 0}%` }}
          />
        </div>

        <p className="mb-2.5 text-[11px] font-bold tracking-[0.1em] text-honey-400 uppercase">Who called it</p>
        <ul className="flex flex-col gap-[9px]">
          {outcome.callers.map((c, i) => (
            <li
              key={c.nickname}
              className={cn(
                'animate-demo-fade-left flex items-center justify-between gap-2.5 rounded-lg',
                c.isYou && '-mx-2 bg-honey-500/10 px-2 py-1'
              )}
              style={{ animationDelay: `${i * 90 + 100}ms` }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-extrabold text-paper-white/70">
                  {i + 1}
                </span>
                <span className={cn('truncate text-[14px] font-extrabold', c.isYou ? 'text-honey-300' : 'text-paper-white')}>
                  {c.isYou ? 'You' : `@${c.nickname}`}
                </span>
                <span className="shrink-0 text-xs text-paper-white/50">{formatTokens(c.amount)} &rarr;</span>
              </div>
              <div className="flex shrink-0 items-baseline gap-1.5">
                <b className="text-[15px] font-extrabold text-honey-300">{formatTokens(c.payout)}</b>
                <span className="text-[10px] font-bold text-paper-white/40">{(c.payout / c.amount).toFixed(1)}&times;</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-[18px] flex flex-col items-center gap-1.5 border-t border-white/10 pt-3.5">
          <div className="flex items-center gap-1.5">
            <img src="/barbets-mono-white.png" alt="" width={13} height={13} />
            <span className="text-[11px] font-extrabold tracking-[0.07em] text-paper-white/55 uppercase">Barbets</span>
          </div>
          <span className="text-[10px] tracking-[0.02em] text-paper-white/30">This was a demo, no real tokens moved.</span>
        </div>
      </div>
    </div>
  );
}
