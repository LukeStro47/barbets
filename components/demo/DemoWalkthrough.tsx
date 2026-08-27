'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Mention } from '@/components/ui/Mention';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { CaretLeftIcon, CameraIcon, PlusIcon, AtSignIcon, UsersIcon, CalendarIcon } from '@/components/ui/icons';
import { TicketCard } from '@/components/markets/TicketCard';
import { PoolStrip } from '@/components/markets/PoolStrip';
import { ResolutionTimeline } from '@/components/markets/ResolutionTimeline';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';
import { MARKET_TYPE_ICON } from '@/lib/marketType';
import { cn } from '@/lib/cn';
import {
  DEMO_QUESTION,
  DEMO_STARTING_BALANCE,
  SEED_BET_COUNT,
  SEED_POOL_TOTAL,
  resolveDemoBet,
  type DemoOutcome,
  type DemoSide,
} from '@/lib/demoScenario';
import { DemoBetslip } from '@/components/demo/DemoBetslip';
import { DemoRevealCard } from '@/components/demo/DemoRevealCard';

const STEP_COUNT = 6;
const PROPOSER_NICKNAME = 'sam';
const JUSTIFICATION = 'Chip time 3:52. Screenshot attached.';

/** Closes-in caption is purely cosmetic here — nothing in the demo actually gates on it. */
const COSMETIC_CLOSES_AT = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const CTA_CLASS =
  'animate-demo-fade-up-btn w-full rounded-full bg-honey-500 py-[15px] text-base font-extrabold text-espresso-950 transition-all duration-150 hover:bg-honey-600 active:scale-[0.97] disabled:bg-honey-500/40 disabled:text-espresso-950/40 disabled:active:scale-100';

type VoteChoice = 'yes' | 'no' | 'void';
const BALLOT_CHOICES: { value: VoteChoice; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'void', label: 'Void' },
];

/** Same tab glyphs as BottomNav.tsx, copied verbatim rather than rendering the real (stateful,
 * Supabase-driven) component in a non-interactive diagram. */
const NAV_TABS: { d: string; isPlus?: boolean; active?: boolean }[] = [
  { d: 'M4 11.5 12 4l8 7.5M6 10v9h5v-5h2v5h5v-9' },
  { d: 'M3 17l5-5 3 3 6-7M14 8h5v5', active: true },
  { d: '', isPlus: true },
  { d: 'M8 20V11M14 20V4M20 20v-7M2 20h20' },
  { d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-7 7-7s7 3.1 7 7' },
];
const NAV_LABELS = ['Groups', 'Markets', 'New', 'Board', 'You'];

/** A minimal, self-contained neutral odds bar so its fill can animate 0 -> real percent on entry —
 * the shared NeutralOddsBar always renders pre-filled, with no transition. */
function AnimatedOddsBar({
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
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[15px] font-extrabold text-espresso-950">
        <span className="whitespace-nowrap">
          {leftLabel} <span className="tabular-nums">{leftPercent}%</span>
        </span>
        <span className="whitespace-nowrap">
          {rightLabel} <span className="tabular-nums">{rightPercent}%</span>
        </span>
      </div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-honey-500 transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ width: `${revealed ? leftPercent : 0}%` }}
        />
        <div
          className="h-full rounded-full bg-honey-200 transition-[width] duration-[900ms] delay-[50ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ width: `${revealed ? rightPercent : 0}%` }}
        />
      </div>
    </div>
  );
}

/** A non-Supabase stand-in for ResolutionProofButton — the real one fetches a signed URL for a
 * real photo_path, which this demo market doesn't have. Same "chip" look, a static modal instead. */
function DemoProofChip() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-espresso-50 px-[13px] py-[7px] text-[12.5px] font-bold whitespace-nowrap text-espresso-600 transition-colors hover:bg-espresso-100"
      >
        <CameraIcon className="h-3 w-3" />
        Proof
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <p className="font-display font-bold text-espresso-900">Proof photo</p>
          <p className="text-sm text-espresso-500">
            This is a demo, so there&apos;s no real photo, just the idea that a proposer can attach one.
          </p>
          <Button className="w-full" onClick={() => setOpen(false)}>
            Close
          </Button>
        </Modal>
      )}
    </>
  );
}

function FactRow({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-espresso-100 bg-paper-white p-3.5">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-espresso-50 text-espresso-600">{icon}</span>
      <div>
        <p className="text-[13.5px] font-extrabold text-espresso-950">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-[1.45] text-espresso-500">{body}</p>
      </div>
    </div>
  );
}

/**
 * The first-run explainer, folded into a six-step guided market: a full lifecycle (open -> closed
 * odds -> proposed -> contested -> settled) ending on where things live in the app, so nothing is
 * explained before it has happened.
 *
 * The flow makes no Supabase calls on any step — DemoProofChip and the ballot card below are
 * local stand-ins for the real ResolutionProofButton/MarketActions, which call server actions
 * this fake market has no backing rows for.
 */
export function DemoWalkthrough({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [betslipOpen, setBetslipOpen] = useState(false);
  const [side, setSide] = useState<DemoSide | null>(null);
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);
  const [vote, setVote] = useState<VoteChoice | null>(null);
  const [ballotExpanded, setBallotExpanded] = useState(true);
  const [barsRevealed, setBarsRevealed] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // The odds bars start at 0% and animate in to their real value whenever a step that has one
  // (closed, settled) becomes active.
  useEffect(() => {
    if (step !== 1 && step !== 4) return;
    setBarsRevealed(false);
    const id = setTimeout(() => setBarsRevealed(true), 60);
    return () => clearTimeout(id);
  }, [step]);

  function handleBetConfirmed(betSide: DemoSide, amount: number) {
    setSide(betSide);
    setOutcome(resolveDemoBet(betSide, amount));
    setStep(1);
  }

  function handleBack() {
    if (betslipOpen) {
      setBetslipOpen(false);
      return;
    }
    if (step === 0) {
      if (typeof window !== 'undefined' && window.history.length > 1) router.back();
      else router.push(isLoggedIn ? '/groups' : '/');
      return;
    }
    setStep((s) => s - 1);
  }

  function handlePrimary() {
    if (step === 0) {
      setBetslipOpen(true);
      return;
    }
    if (step === 3 && vote === null) return;
    setStep((s) => s + 1);
  }

  const stakeAmount = outcome?.callers.find((c) => c.isYou)?.amount ?? 0;

  const coach = [
    'Bets stay sealed while a market is open. Nobody sees who bet what.',
    'Betting closed, so the sealed bets become visible odds. Bets are locked in now.',
    'Unchallenged, this call becomes final. If it looks wrong, anyone can challenge it.',
    'Ballots stay hidden until voting closes. A tie upholds the proposal.',
    'Winners split the losers’ stakes in proportion to what they staked.',
  ][step];

  const ctaLabel = [
    'Place a bet',
    'See who calls it',
    'Challenge this call',
    vote === null ? 'Pick an answer first' : 'Close the vote',
    'One last thing',
  ][step];

  return (
    <div className="pb-36">
      <div className="mb-[18px] flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="-ml-1 inline-flex items-center gap-0.5 text-[13px] font-bold text-espresso-500 hover:text-espresso-800"
        >
          <CaretLeftIcon className="h-[15px] w-[15px]" />
          Back
        </button>
        <span className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-300 uppercase">Demo market</span>
      </div>

      <div className="mb-[22px] flex gap-1.5">
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'block h-1.5 rounded-full transition-all duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              i === step ? 'w-[22px] bg-honey-500' : i < step ? 'w-1.5 bg-honey-500' : 'w-1.5 bg-espresso-100'
            )}
          />
        ))}
      </div>

      <div key={step}>
        {step === 0 && (
          <div>
            <TicketCard
              label="The question"
              meta={<Badge tone={STATUS_TONE.open}>{STATUS_LABEL.open}</Badge>}
              className="animate-demo-fade-up-scale"
              bodyClassName="px-[18px] py-4"
            >
              <div className="space-y-3.5">
                <p className="font-display text-xl leading-[1.25] font-extrabold tracking-[-0.01em] text-espresso-950">{DEMO_QUESTION}</p>
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-espresso-500">
                  <span className="text-[19px] text-espresso-400">{MARKET_TYPE_ICON.yes_no}</span>
                  <span>
                    Yes / No &middot; started by <Mention nickname="priya" />
                  </span>
                </div>
              </div>
            </TicketCard>
            <PoolStrip
              className="mt-3"
              cells={[
                { label: 'Pool', value: formatTokens(SEED_POOL_TOTAL) },
                { label: 'Bets', value: SEED_BET_COUNT },
                { label: 'Closes', value: <CountdownTimer target={COSMETIC_CLOSES_AT} prefix="" /> },
              ]}
            />
            <p className="animate-demo-fade-up mt-3.5 text-[13px] text-espresso-400" style={{ animationDelay: '140ms' }}>
              You hold {formatTokens(DEMO_STARTING_BALANCE)} demo tokens.
            </p>
          </div>
        )}

        {step === 1 && outcome && side && (
          <TicketCard
            label="Odds at close"
            meta={<Badge tone={STATUS_TONE.closed}>{STATUS_LABEL.closed}</Badge>}
            className="animate-demo-fade-up-scale"
            bodyClassName="px-[18px] py-4"
          >
            <div className="space-y-4">
              <p className="text-[16.5px] leading-[1.3] font-bold text-espresso-950">{DEMO_QUESTION}</p>
              <AnimatedOddsBar leftLabel="YES" leftPercent={outcome.yesPercent} rightLabel="NO" rightPercent={outcome.noPercent} revealed={barsRevealed} />
              <div className="flex items-center justify-between gap-3 border-t border-espresso-50 pt-3.5">
                <span className="text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Your position</span>
                <span className="text-[15px] font-extrabold text-espresso-950">
                  {formatTokens(stakeAmount)} on {side.toUpperCase()}
                </span>
              </div>
            </div>
          </TicketCard>
        )}

        {step === 2 && outcome && side && (
          <div>
            <TicketCard
              label="Proposed outcome"
              meta={
                <>
                  by <Mention nickname={PROPOSER_NICKNAME} />
                </>
              }
              className="animate-demo-fade-up-scale"
              bodyClassName="px-[18px] pt-4 pb-[18px]"
            >
              <div className="space-y-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[34px] leading-none font-extrabold tracking-[-0.02em] text-espresso-950">{side.toUpperCase()}</p>
                  <DemoProofChip />
                </div>
                <p className="text-[14.5px] leading-[1.45] text-espresso-700 text-pretty">&ldquo;{JUSTIFICATION}&rdquo;</p>
                <div className="flex items-center justify-between gap-3 border-t border-espresso-50 pt-3.5">
                  <span className="text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Your position</span>
                  <span className="text-[15px] font-extrabold text-success-700">
                    {formatTokens(stakeAmount)} on {side.toUpperCase()} wins
                  </span>
                </div>
              </div>
            </TicketCard>
            <Card className="mt-3">
              <ResolutionTimeline resolutionWindowHours={2} stage="proposed" proposerNickname={PROPOSER_NICKNAME} />
            </Card>
          </div>
        )}

        {step === 3 && side && (
          <div className="animate-demo-fade-up-scale overflow-hidden rounded-[22px] border-[1.5px] border-danger-500 bg-paper-white shadow-[0_6px_18px_-10px_rgba(28,19,13,0.35)]">
            <div className="flex items-center justify-between gap-2 bg-danger-100 px-[18px] py-3">
              <p className="text-xs font-extrabold tracking-[0.06em] text-danger-700 uppercase">Your ballot</p>
              <p className="text-[12.5px] font-bold text-danger-700">{vote === null ? 3 : 4} of 6 voted</p>
            </div>
            <div className="space-y-3.5 p-[18px]">
              <div className="space-y-1 rounded-2xl bg-espresso-50 p-3.5">
                <p className="text-xs text-espresso-500">
                  <Mention nickname={PROPOSER_NICKNAME} /> proposed <strong className="font-extrabold text-espresso-900">{side.toUpperCase()}</strong>
                </p>
                <p className="text-[13.5px] leading-[1.4] text-espresso-600">&ldquo;{JUSTIFICATION}&rdquo;</p>
              </div>

              <div className="space-y-0.5">
                <p className="text-base font-extrabold text-espresso-950">What actually happened?</p>
                <p className="text-[13px] leading-[1.4] text-espresso-500">
                  Vote on the outcome, not on whether you agree with the proposal.{' '}
                  <button type="button" onClick={() => setShowRulesModal(true)} className="font-bold text-honey-700">
                    How votes settle
                  </button>
                </p>
              </div>

              {ballotExpanded ? (
                <div className="flex flex-col gap-2">
                  {BALLOT_CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        setVote(c.value);
                        setBallotExpanded(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-2xl border-[1.5px] border-espresso-200 px-3.5 py-3 text-left text-[15px] font-extrabold uppercase text-espresso-500"
                    >
                      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-espresso-200" />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.value === 'void' && <span className="shrink-0 text-xs font-semibold normal-case text-espresso-400">Can&apos;t be judged</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex w-full items-center gap-2.5 rounded-2xl border-[1.5px] border-espresso-900 bg-espresso-900 px-3.5 py-3">
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-honey-300">
                    <span className="h-2 w-2 rounded-full bg-honey-300" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-paper-white">Your vote: {vote?.toUpperCase()}</span>
                  <button type="button" onClick={() => setBallotExpanded(true)} className="shrink-0 text-xs font-bold text-honey-300 underline">
                    Switch vote
                  </button>
                </div>
              )}

              <p className="text-xs text-espresso-400">Secret until voting closes. Change it any time before then.</p>
            </div>
          </div>
        )}

        {step === 4 && side && outcome && <DemoRevealCard question={DEMO_QUESTION} side={side} outcome={outcome} barsRevealed={barsRevealed} />}

        {step === 5 && (
          <div className="animate-demo-fade-up">
            <h2 className="font-display text-[23px] font-extrabold tracking-[-0.01em] text-espresso-900">Where everything lives</h2>

            <div className="mt-[18px] overflow-hidden rounded-[20px] border border-espresso-100 bg-paper-white">
              <div className="relative flex h-[60px] items-center">
                <span aria-hidden className="absolute bottom-[9px] h-[3px] w-[22px] rounded-full bg-honey-600" style={{ left: 'calc(30% - 11px)' }} />
                {NAV_TABS.map((t, i) =>
                  t.isPlus ? (
                    <span key={i} className="flex flex-1 items-center justify-center">
                      <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-espresso-900">
                        <PlusIcon className="h-[19px] w-[19px] text-honey-300" />
                      </span>
                    </span>
                  ) : (
                    <span key={i} className={cn('flex flex-1 items-center justify-center', t.active ? 'text-espresso-950' : 'text-espresso-300')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="h-[23px] w-[23px]">
                        <path d={t.d} />
                      </svg>
                    </span>
                  )
                )}
              </div>
              <div className="flex border-t border-dashed border-espresso-100 bg-paper">
                {NAV_LABELS.map((l) => (
                  <span key={l} className="flex-1 py-2 text-center text-[9.5px] font-extrabold tracking-[0.06em] text-espresso-300 uppercase">
                    {l}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-[18px] flex flex-col gap-2.5">
              <FactRow
                icon={<AtSignIcon className="h-[15px] w-[15px]" />}
                title="@mention someone to hide a market from someone"
                body="They'll know the market exists, just not what it's about."
              />
              <FactRow
                icon={<CalendarIcon className="h-[15px] w-[15px]" />}
                title="Seasons end when you choose"
                body="Balances reset, titles change hands, and betting opens again."
              />
              <FactRow
                icon={<UsersIcon className="h-[15px] w-[15px]" />}
                title="Don't have a group yet? Join a public one"
                body="Public groups run their own markets so you can get a feel for the app."
              />
            </div>
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center bg-[linear-gradient(to_top,var(--color-paper)_62%,transparent)] px-5 pt-[26px] pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <div className="w-full max-w-lg">
          {step < 5 ? (
            <>
              <div key={step} className="animate-demo-fade-up mb-3.5 flex items-start gap-2.5 rounded-2xl bg-paper-dim px-[15px] py-[13px]">
                <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-honey-500 text-[11px] font-extrabold text-espresso-950">i</span>
                <p className="text-[13px] leading-[1.45] text-espresso-700 text-pretty">{coach}</p>
              </div>
              <button key={`cta-${step}`} type="button" onClick={handlePrimary} disabled={step === 3 && vote === null} className={CTA_CLASS}>
                {ctaLabel}
              </button>
            </>
          ) : (
            <div className="animate-demo-fade-up-btn flex flex-col gap-2.5">
              <Link href={isLoggedIn ? '/groups/new' : '/login?mode=signup'} className="block">
                <Button size="lg" variant="accent" className="w-full transition-transform active:scale-[0.97]">
                  Create a Group
                </Button>
              </Link>
              <Link href="/groups/discover" className="block text-center text-[12.5px] text-espresso-400 hover:underline">
                Browse public groups instead
              </Link>
            </div>
          )}
        </div>
      </div>

      <DemoBetslip isOpen={betslipOpen} onClose={() => setBetslipOpen(false)} balance={DEMO_STARTING_BALANCE} onConfirmed={handleBetConfirmed} />

      {showRulesModal && (
        <Modal onClose={() => setShowRulesModal(false)}>
          <p className="font-display font-bold text-espresso-900">How votes settle</p>
          <p className="text-sm text-espresso-600">
            Secret ballot on what actually happened, not on whether you agree with the proposal. Vote VOID if it
            can&apos;t be fairly judged. A tie or no votes upholds the proposal; a tie without it voids instead. Ballots
            reveal once voting closes, early if everyone&apos;s voted. You can change your vote until then.
          </p>
          <Button className="w-full" onClick={() => setShowRulesModal(false)}>
            Got it
          </Button>
        </Modal>
      )}
    </div>
  );
}
