'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OddsBar } from '@/components/markets/OddsBar';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';
import { DEMO_QUESTION, DEMO_STARTING_BALANCE, SEED_BET_COUNT, resolveDemoBet, type DemoOutcome, type DemoSide } from '@/lib/demoScenario';
import { DemoBetslip } from '@/components/demo/DemoBetslip';
import { DemoRevealCard } from '@/components/demo/DemoRevealCard';

type Step = 'open' | 'closed' | 'proposed' | 'resolved';
const STEPS: Step[] = ['open', 'closed', 'proposed', 'resolved'];

/** Closes-in caption is purely cosmetic here — nothing in the demo actually gates on it. */
const COSMETIC_CLOSES_AT = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

/** A visually distinct "here's why" callout above each step's market card — honey-tinted and
 * icon-led so it reads as commentary on the app, never as real market content. Teaches the
 * reasoning behind what's on screen, not just what's currently happening. */
function Explainer({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-honey-300 bg-honey-50 px-3.5 py-3">
      <span className="shrink-0 text-base leading-tight">{icon}</span>
      <p className="text-sm font-semibold leading-snug text-honey-800">{children}</p>
    </div>
  );
}

export function DemoWalkthrough({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [step, setStep] = useState<Step>('open');
  const [side, setSide] = useState<DemoSide | null>(null);
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);

  function handleBetConfirmed(betSide: DemoSide, amount: number) {
    setSide(betSide);
    setOutcome(resolveDemoBet(betSide, amount));
    setStep('closed');
  }

  function replay() {
    setStep('open');
    setSide(null);
    setOutcome(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Badge tone="honey">🧪 Demo &middot; not a real group</Badge>
        <span className="text-xs font-semibold text-espresso-400">
          Step {STEPS.indexOf(step) + 1} of {STEPS.length}
        </span>
      </div>

      {step === 'open' && (
        <div className="space-y-4">
          <Explainer icon="👉">
            This is what an open market looks like. Bets stay sealed while it's open, nobody, not even you, can see who bet
            what until it closes.
          </Explainer>
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display font-bold leading-snug text-espresso-900">{DEMO_QUESTION}</p>
              <Badge tone={STATUS_TONE.open}>{STATUS_LABEL.open}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm text-espresso-500">
              <span>🤫 {SEED_BET_COUNT} bets placed</span>
              <CountdownTimer target={COSMETIC_CLOSES_AT} />
            </div>
          </Card>
          <p className="text-sm text-espresso-500">
            You've got {formatTokens(DEMO_STARTING_BALANCE)} demo tokens. Pick a side and stake some of them.
          </p>
          <DemoBetslip balance={DEMO_STARTING_BALANCE} onConfirmed={handleBetConfirmed} />
        </div>
      )}

      {step === 'closed' && outcome && (
        <div className="space-y-4">
          <Explainer icon="🔎">
            The moment betting closes, hidden bets flip into a visible odds split, this is the exact moment odds become
            real to look at.
          </Explainer>
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display font-bold leading-snug text-espresso-900">{DEMO_QUESTION}</p>
              <Badge tone={STATUS_TONE.closed}>{STATUS_LABEL.closed}</Badge>
            </div>
            <p className="text-sm text-espresso-500">Betting just closed, odds are live.</p>
            <OddsBar left={{ label: 'YES', percent: outcome.yesPercent }} right={{ label: 'NO', percent: outcome.noPercent }} />
          </Card>
          <Button size="lg" className="w-full" onClick={() => setStep('proposed')}>
            See what happened next
          </Button>
        </div>
      )}

      {step === 'proposed' && side && (
        <div className="space-y-4">
          <Explainer icon="🗳️">
            Someone in the group says what actually happened. Nobody disagrees, it locks in. Enough people do, it goes to a
            secret group vote instead.
          </Explainer>
          <Card className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="font-display font-bold leading-snug text-espresso-900">{DEMO_QUESTION}</p>
              <Badge tone={STATUS_TONE.proposed}>{STATUS_LABEL.proposed}</Badge>
            </div>
            <p className="text-sm font-semibold text-espresso-700">Proposed: {side.toUpperCase()}</p>
            <p className="text-sm text-espresso-500">Nobody challenged this one, so it stands.</p>
          </Card>
          <Button size="lg" className="w-full" onClick={() => setStep('resolved')}>
            Reveal the result
          </Button>
        </div>
      )}

      {step === 'resolved' && side && outcome && (
        <div className="space-y-5">
          <p className="text-center font-display text-xl font-bold text-honey-700">
            You won {formatTokens(outcome.payout)} tokens!
          </p>
          <Explainer icon="💰">
            Winners split the losers' stakes proportional to their bet, no bookmaker skims a cut. That's what parimutuel
            means.
          </Explainer>
          <DemoRevealCard question={DEMO_QUESTION} side={side} outcome={outcome} />
          <Card className="text-sm text-espresso-600">
            If this market had @mentioned a friend instead, they wouldn't have seen it exists, anywhere, until right now.
            That's the whole point.
          </Card>

          <div className="space-y-2 pt-1">
            <Link href={isLoggedIn ? '/groups/new' : '/login?mode=signup'} className="block">
              <Button size="lg" variant="accent" className="w-full">
                {isLoggedIn ? 'Create your real group' : 'Start Betting'}
              </Button>
            </Link>
            <Link href="/how-it-works" className="block">
              <Button size="lg" variant="outline" className="w-full">
                Read the full rules
              </Button>
            </Link>
            <button type="button" onClick={replay} className="w-full text-center text-sm font-medium text-espresso-400 hover:text-espresso-700">
              Replay the demo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
