'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import { DEMO_QUESTION, DEMO_STARTING_BALANCE, SEED_BET_COUNT, resolveDemoBet, type DemoOutcome, type DemoSide } from '@/lib/demoScenario';
import { DemoBetslip } from '@/components/demo/DemoBetslip';
import { DemoRevealCard } from '@/components/demo/DemoRevealCard';

type Step = 'open' | 'closed' | 'proposed' | 'resolved';
const STEPS: Step[] = ['open', 'closed', 'proposed', 'resolved'];

const STEP_COPY: Record<Step, { title: string; description: string }> = {
  open: {
    title: 'Open market',
    description: "Bets stay sealed while it's open. Nobody sees who bet what until it closes.",
  },
  closed: {
    title: 'Odds are live',
    description: 'Betting just closed. Hidden bets just flipped into a visible split. From here, anyone in the group can propose what happened.',
  },
  proposed: {
    title: 'Resolution proposed',
    description: 'Someone said what happened. Unchallenged, it locks in. Enough pushback sends it to a vote.',
  },
  resolved: {
    title: "Result's in",
    description: "Winners split the losers' stakes proportional to their bet. Parimutuel, no bookmaker skim.",
  },
};

/** Closes-in caption is purely cosmetic here — nothing in the demo actually gates on it. */
const COSMETIC_CLOSES_AT = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const CTA_CLASS =
  'animate-demo-fade-up-btn w-full rounded-full bg-honey-500 py-[15px] text-base font-extrabold text-espresso-950 transition-all duration-150 hover:bg-honey-600 active:scale-[0.97]';

/** A minimal, self-contained odds bar so its fill can animate 0 -> real percent on entry —
 * the shared OddsBar always renders pre-filled, with no transition. */
function DemoOddsBar({
  leftLabel,
  leftPercent,
  rightLabel,
  rightPercent,
  revealed,
}: {
  leftLabel: string;
  leftPercent: number;
  rightLabel: string;
  rightPercent: number;
  revealed: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm font-semibold">
        <span className="text-honey-800">
          {leftLabel} {leftPercent}%
        </span>
        <span className="text-espresso-500">
          {rightLabel} {rightPercent}%
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-espresso-100">
        <div
          className="h-full bg-honey-500 transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ width: `${revealed ? leftPercent : 0}%` }}
        />
        <div
          className="h-full bg-espresso-300 transition-[width] duration-[900ms] delay-[50ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ width: `${revealed ? rightPercent : 0}%` }}
        />
      </div>
    </div>
  );
}

export function DemoWalkthrough({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [step, setStep] = useState<Step>('open');
  const [side, setSide] = useState<DemoSide | null>(null);
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);
  const [betslipOpen, setBetslipOpen] = useState(false);
  const [barsRevealed, setBarsRevealed] = useState(false);
  // Bumped on replay to force DemoBetslip to remount, resetting its internal side/amount
  // selection back to defaults — it otherwise persists as a top-level sibling across steps.
  const [betslipKey, setBetslipKey] = useState(0);

  const stepIndex = STEPS.indexOf(step);
  const { title, description } = STEP_COPY[step];

  // The odds bars start at 0% and animate in to their real value whenever a step that has
  // one (closed, resolved) becomes active.
  useEffect(() => {
    if (step !== 'closed' && step !== 'resolved') return;
    setBarsRevealed(false);
    const id = setTimeout(() => setBarsRevealed(true), 60);
    return () => clearTimeout(id);
  }, [step]);

  function handleBetConfirmed(betSide: DemoSide, amount: number) {
    setSide(betSide);
    setOutcome(resolveDemoBet(betSide, amount));
    setStep('closed');
  }

  function replay() {
    setStep('open');
    setSide(null);
    setOutcome(null);
    setBarsRevealed(false);
    setBetslipKey((k) => k + 1);
  }

  return (
    <div className="pb-32">
      <div className="mb-[26px] flex justify-center gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={cn(
              'block h-1.5 rounded-full transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              i === stepIndex ? 'w-[22px] bg-honey-500' : i < stepIndex ? 'w-1.5 bg-honey-500' : 'w-1.5 bg-espresso-100'
            )}
          />
        ))}
      </div>

      <div key={step} className="animate-demo-fade-up mb-4">
        <h1 className="font-display text-[23px] font-extrabold tracking-[-0.01em] text-espresso-900">{title}</h1>
        <p className="mt-1.5 text-[14.5px] leading-[1.5] text-espresso-500">{description}</p>
      </div>

      {step === 'open' && (
        <div className="space-y-4">
          <Card className="animate-demo-fade-up-scale !rounded-[20px] space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display font-bold leading-snug text-espresso-900">{DEMO_QUESTION}</p>
              <Badge tone={STATUS_TONE.open}>{STATUS_LABEL.open}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm text-espresso-500">
              <span>{SEED_BET_COUNT} bets placed</span>
              <CountdownTimer target={COSMETIC_CLOSES_AT} />
            </div>
          </Card>
          <p className="animate-demo-fade-up text-[13px] text-espresso-400" style={{ animationDelay: '140ms' }}>
            You've got {formatTokens(DEMO_STARTING_BALANCE)} demo tokens. Pick a side and stake some.
          </p>
        </div>
      )}

      {step === 'closed' && outcome && (
        <Card className="animate-demo-fade-up-scale !rounded-[20px] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-display font-bold leading-snug text-espresso-900">{DEMO_QUESTION}</p>
            <Badge tone={STATUS_TONE.closed}>{STATUS_LABEL.closed}</Badge>
          </div>
          <DemoOddsBar leftLabel="YES" leftPercent={outcome.yesPercent} rightLabel="NO" rightPercent={outcome.noPercent} revealed={barsRevealed} />
        </Card>
      )}

      {step === 'proposed' && side && (
        <Card className="animate-demo-fade-up-scale !rounded-[20px] space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="font-display font-bold leading-snug text-espresso-900">{DEMO_QUESTION}</p>
            <Badge tone={STATUS_TONE.proposed}>{STATUS_LABEL.proposed}</Badge>
          </div>
          <p className="text-sm font-bold text-espresso-700">Proposed: {side.toUpperCase()}</p>
          <p className="text-[13px] text-espresso-400">Nobody challenged this one, so it stands.</p>
        </Card>
      )}

      {step === 'resolved' && side && outcome && (
        <div className="space-y-4">
          <DemoRevealCard question={DEMO_QUESTION} side={side} outcome={outcome} payoutLabel={formatTokens(outcome.payout)} barsRevealed={barsRevealed} />
          <p
            className="animate-demo-fade-up text-center text-xs leading-[1.5] text-espresso-300"
            style={{ animationDelay: '200ms' }}
          >
            If this had @mentioned a friend instead, they wouldn't have seen it exists, anywhere, until right now.
          </p>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center bg-[linear-gradient(to_top,var(--color-paper)_60%,transparent)] px-5 pt-[26px] pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <div className="w-full max-w-lg">
          {step === 'open' && (
            <button type="button" onClick={() => setBetslipOpen(true)} className={CTA_CLASS}>
              Place a bet
            </button>
          )}
          {step === 'closed' && (
            <button type="button" onClick={() => setStep('proposed')} className={CTA_CLASS}>
              See what happens next
            </button>
          )}
          {step === 'proposed' && (
            <button type="button" onClick={() => setStep('resolved')} className={CTA_CLASS}>
              Reveal the result
            </button>
          )}
          {/* "Start betting" was a promise the app can't keep from here: there's nothing to bet
              on until you're in a group with other people, so the honest next step is making one.
              Going home stays available underneath for anyone who just wanted the tour. */}
          {step === 'resolved' && (
            <div className="animate-demo-fade-up-btn flex flex-col gap-2.5">
              <Link href={isLoggedIn ? '/groups/new' : '/login?mode=signup'} className="block">
                <Button size="lg" variant="accent" className="w-full transition-transform active:scale-[0.97]">
                  Create a Group
                </Button>
              </Link>
              <p className="text-center text-[12.5px] leading-[1.5] text-espresso-400">
                A group is where markets live. Not ready?{' '}
                <Link href={isLoggedIn ? '/groups' : '/'} className="font-semibold text-espresso-600 underline">
                  Head back home
                </Link>
                .
              </p>
              <button
                type="button"
                onClick={replay}
                className="w-full text-center text-[13px] font-semibold text-espresso-400 transition-colors hover:text-espresso-700"
              >
                Replay the demo
              </button>
            </div>
          )}
        </div>
      </div>

      <DemoBetslip
        key={betslipKey}
        isOpen={betslipOpen}
        onClose={() => setBetslipOpen(false)}
        balance={DEMO_STARTING_BALANCE}
        onConfirmed={handleBetConfirmed}
      />
    </div>
  );
}
