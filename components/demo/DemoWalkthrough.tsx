'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FooterButton, ScreenHeader, StatCell, StickyFooter } from '@/components/ui/Screen';
import { ClosedBetBox, ClosedOddsCard, CriteriaCard, NextStepsCard, StatusChip, sideTitle } from '@/components/markets/MarketScreen';
import { LoadingAnimation } from '@/components/ui/LoadingAnimation';
import { formatSignedTokens, formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import { DEMO_QUESTION, DEMO_STARTING_BALANCE, resolveDemoBet, type DemoOutcome, type DemoSide } from '@/lib/demoScenario';

const STEP_COUNT = 6;
const CREATOR = 'priya';
const PROPOSER = 'sam';
const CHALLENGER = 'marcus';
const JUSTIFICATION = 'Chip time 3:52. Screenshot in the chat.';
/** The same quick amounts the real bet card offers: fractions of the group's starting balance. */
const QUICK = [25, 50, 100, 250];

type Vote = 'yes' | 'no' | 'void';

/**
 * /demo: a six-step guided market (open, closed, called, challenged, settled, where things live),
 * drawn with the same pieces as the real market page (MarketScreen, the 4h bet card, the 5j
 * ticket, the 5k ballot, the 4m result) so what someone learns here is what they'll see in a
 * group. Nothing touches Supabase: the other bettors are made up, but the payout is the real
 * parimutuel formula (lib/demoScenario.ts), so the number at the end is genuinely computed.
 */
export function DemoWalkthrough({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [side, setSide] = useState<DemoSide | null>(null);
  const [amount, setAmount] = useState('50');
  const [ticketOpen, setTicketOpen] = useState(false);
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);
  const [vote, setVote] = useState<Vote | null>(null);

  const amountNum = amount === '' ? 0 : Number(amount);
  const canPlace = !!side && amountNum >= 1 && amountNum <= DEMO_STARTING_BALANCE;
  const stake = outcome?.callers.find((c) => c.isYou)?.amount ?? amountNum;

  function back() {
    if (ticketOpen) return setTicketOpen(false);
    if (step > 0) return setStep((s) => s - 1);
    if (window.history.length > 1) router.back();
    else router.push(isLoggedIn ? '/groups' : '/');
  }

  function place() {
    if (!canPlace || !side) return;
    setOutcome(resolveDemoBet(side, amountNum));
    setTicketOpen(true);
  }

  const coach = [
    'Bets are sealed while a market is open. Nobody sees who backed what, or how the money splits.',
    'Betting shut, so the split became the odds. Your return is fixed from here.',
    "Someone calls what happened. If nobody objects inside the window, it stands.",
    'Someone objected, so the group votes. Ballots stay sealed until the window shuts.',
    'Winners split the losing side in proportion to what each of them staked.',
    null,
  ][step];

  const dots = (
    <span aria-label={`Step ${step + 1} of ${STEP_COUNT}`} className="flex shrink-0 items-center gap-1">
      {Array.from({ length: STEP_COUNT }).map((_, i) => (
        <span key={i} className={cn('h-[5px] rounded-[3px] transition-all duration-300', i === step ? 'w-[18px] bg-ink' : i < step ? 'w-[5px] bg-ink' : 'w-[5px] bg-edge')} />
      ))}
    </span>
  );

  const youSideLabel = side ? sideTitle(side) : '';
  const otherSide: DemoSide = side === 'no' ? 'yes' : 'no';

  return (
    <div className="min-h-dvh bg-canvas">
      <ScreenHeader title="Demo market" onTile={back} right={dots} />

      <div key={step} className="mx-auto max-w-[430px] animate-demo-fade-up px-[18px] pt-5 pb-[230px]">
        {step < 5 && (
          <div className="mb-3.5 flex items-start justify-between gap-3">
            <span className="min-w-0">
              <h1 className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.022em] text-ink text-pretty">{DEMO_QUESTION}</h1>
              <p className="mt-1.5 text-[12.5px] text-faint">
                Yes or no · started by @{CREATOR}
                {step === 0 && ' · closes in 2h 15m'}
              </p>
            </span>
            <StatusChip
              label={['Open', 'Closed', 'Called', 'Challenged', 'Settled'][step]!}
              tone={step === 0 ? 'quiet' : 'ink'}
            />
          </div>
        )}

        {/* ---- 0: open, the 4h bet card ---- */}
        {step === 0 && (
          <div className="flex flex-col gap-[11px]">
            <div className="overflow-hidden rounded-[22px] border-[1.5px] border-edge bg-surface shadow-[0_10px_26px_-18px_rgba(12,16,24,0.5)]">
              <div className="flex items-center justify-between gap-2.5 border-b border-rule bg-wash px-4 py-3">
                <span className="text-[13px] font-extrabold tracking-[-0.01em] text-ink">Your bet</span>
                <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full border border-signal-edge bg-signal-tint px-[9px] py-1 text-[10.5px] font-bold whitespace-nowrap text-signal">
                  <LockGlyph size={10} />
                  Sealed until close
                </span>
              </div>
              <div className="px-[15px] pt-[13px] pb-[15px]">
                <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Pick a side</p>
                <div className="mt-2 flex gap-2">
                  {(['yes', 'no'] as const).map((s) => {
                    const on = side === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSide(s)}
                        className={cn(
                          'flex min-h-[46px] flex-1 items-center justify-center rounded-[13px] border-[1.5px] text-[15px] font-extrabold tracking-[-0.01em]',
                          on ? 'border-signal bg-signal-wash text-ink shadow-[0_0_0_3px_rgba(45,85,245,0.09)]' : 'border-hairline bg-surface text-muted'
                        )}
                      >
                        {sideTitle(s)}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-3.5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Your stake</p>
                <div className="mt-2 flex items-center justify-between gap-3 rounded-[15px] bg-ink px-[17px] py-[13px]">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={DEMO_STARTING_BALANCE}
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    aria-label="Stake"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[29px] leading-none font-semibold tracking-[-0.02em] text-surface tabular-nums placeholder:text-surface/25 focus:outline-none"
                  />
                  <span className="shrink-0 font-mono text-[11.5px] whitespace-nowrap text-surface/55">of {formatTokens(DEMO_STARTING_BALANCE)} free</span>
                </div>
                <div className="mt-2 flex gap-[7px]">
                  {[...QUICK.map((q) => ({ key: String(q), value: q, label: formatTokens(q), sans: false })), { key: 'max', value: DEMO_STARTING_BALANCE, label: 'Max', sans: true }].map(
                    (q) => (
                      <button
                        key={q.key}
                        type="button"
                        onClick={() => setAmount(String(q.value))}
                        className={cn(
                          'flex-1 rounded-[11px] border py-2 text-center text-[12.5px]',
                          q.sans ? 'font-sans' : 'font-mono',
                          amountNum === q.value ? 'border-signal-edge bg-signal-tint font-bold text-signal' : 'border-hairline bg-surface font-semibold text-muted'
                        )}
                      >
                        {q.label}
                      </button>
                    )
                  )}
                </div>

                <div className="mt-[11px] flex items-center justify-between gap-2.5 rounded-xl border border-rule bg-canvas px-[13px] py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.4] text-muted">
                    {side ? (
                      <>
                        {formatTokens(amountNum)} on <span className="font-bold text-ink">{youSideLabel}</span>
                      </>
                    ) : (
                      'Pick a side above'
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-faint">{formatTokens(Math.max(0, DEMO_STARTING_BALANCE - amountNum))} left</span>
                </div>
                <button
                  type="button"
                  disabled={!canPlace}
                  onClick={place}
                  className="mt-2.5 w-full rounded-[14px] bg-signal py-3.5 text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] transition-colors hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
                >
                  {side ? `Place ${formatTokens(amountNum)} on ${youSideLabel}` : 'Pick a side to continue'}
                </button>
              </div>
            </div>

            <CriteriaCard compact label="How it settles" description="Yes if Jake's official chip time is under 4:00:00. No if it's over, or he doesn't finish." />
          </div>
        )}

        {/* ---- 1: closed, 4n ---- */}
        {step === 1 && outcome && side && (
          <div className="flex flex-col gap-[11px]">
            <ClosedOddsCard
              pool={outcome.totalPool}
              mySideKey={side}
              sides={[
                { key: 'yes', label: 'Yes', percent: outcome.yesPercent, staked: Math.round((outcome.totalPool * outcome.yesPercent) / 100) },
                { key: 'no', label: 'No', percent: outcome.noPercent, staked: Math.round((outcome.totalPool * outcome.noPercent) / 100) },
              ]}
            />
            <ClosedBetBox amount={stake} label={youSideLabel} pays={outcome.payout} />
            <NextStepsCard
              steps={[
                { title: 'Betting closed', sub: 'The split is the price now', state: 'done' },
                { title: 'Someone calls it', sub: 'Anyone in the group says what happened', state: 'current' },
                { title: 'Two hours to object', sub: 'Or it settles as called', state: 'upcoming' },
              ]}
            />
          </div>
        )}

        {/* ---- 2: called ---- */}
        {step === 2 && outcome && side && (
          <div className="flex flex-col gap-[11px]">
            <div className="rounded-[20px] border border-hairline bg-surface px-[18px] py-4">
              <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">@{PROPOSER} called it</p>
              <p className="mt-1.5 text-[24px] font-extrabold tracking-[-0.02em] text-ink">{youSideLabel}</p>
              <p className="mt-2 text-[13px] leading-[1.5] text-muted text-pretty">&ldquo;{JUSTIFICATION}&rdquo;</p>
            </div>
            <ClosedBetBox amount={stake} label={youSideLabel} pays={outcome.payout} />
            <NextStepsCard
              steps={[
                { title: 'Betting closed', state: 'done' },
                { title: `@${PROPOSER} called it ${youSideLabel}`, state: 'done' },
                { title: 'Two hours to object', sub: 'Anyone who thinks the call is wrong can challenge it', state: 'current' },
                { title: 'Settles', sub: 'Winners are paid out', state: 'upcoming' },
              ]}
            />
          </div>
        )}

        {/* ---- 3: challenged, the 5k ballot ---- */}
        {step === 3 && side && (
          <div>
            <div className="rounded-[22px] bg-ink p-5">
              <p className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">{CHALLENGER} challenged the call</p>
              <p className="mt-3 text-[20px] leading-[1.25] font-extrabold tracking-[-0.02em] text-surface text-pretty">{DEMO_QUESTION}</p>
              <div className="mt-4 flex items-center gap-3 border-t border-white/12 pt-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold tracking-[0.1em] text-faint uppercase">{PROPOSER} called it</span>
                  <span className="mt-1 block truncate text-[16px] font-extrabold text-surface">{youSideLabel}</span>
                </span>
                <span className="shrink-0 rounded-lg bg-white/12 px-2.5 py-[5px] text-[11.5px] font-bold text-disabled-ink">In dispute</span>
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.45] text-disabled-ink">&ldquo;{JUSTIFICATION}&rdquo;</p>
            </div>

            <p className="mt-[22px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">What actually happened</p>
            <div className="mt-[9px] flex flex-col gap-2">
              {(
                [
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                  { value: 'void', label: 'Nobody can say', sub: 'Voids the market, every stake back' },
                ] as { value: Vote; label: string; sub?: string }[]
              ).map((c) => {
                const on = vote === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setVote(c.value)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl px-4 py-[15px] text-left',
                      on ? 'border-[1.5px] border-signal bg-signal-wash' : 'border border-hairline bg-surface'
                    )}
                  >
                    <span className={cn('h-[18px] w-[18px] shrink-0 rounded-full bg-surface', on ? 'border-[5px] border-signal' : 'border-[1.5px] border-dash')} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[15.5px]', on ? 'font-extrabold text-ink' : 'font-bold text-muted')}>{c.label}</span>
                      {c.sub && <span className="mt-0.5 block text-[11.5px] text-faint">{c.sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-[11px] rounded-2xl border border-hairline bg-surface px-[15px] py-3.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-tile text-muted">
                <LockGlyph size={15} />
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-muted text-pretty">
                Sealed. Nobody sees a single vote, yours included, until the window shuts.
              </span>
            </div>
            <div className="mt-3 flex rounded-2xl border border-hairline bg-surface px-4 py-[15px]">
              <StatCell first label="Final in" value="1h 40m" tone="signal" />
              <StatCell label="Voted" value={`${vote ? 4 : 3} of 6`} />
              <StatCell label="Your stake" value={formatTokens(stake)} flex={1.1} />
            </div>
            <p className="mt-3.5 text-[12px] leading-[1.5] text-faint text-pretty">
              Most votes wins. No votes, or a tie that includes the call, keeps the call. Any other tie voids the market and every stake goes back.
            </p>
          </div>
        )}

        {/* ---- 4: settled, 4m ---- */}
        {step === 4 && side && outcome && (
          <div className="flex flex-col gap-[11px]">
            <div className="overflow-hidden rounded-[20px] border-[1.5px] border-gain-line bg-surface shadow-[0_8px_20px_-16px_rgba(11,138,91,0.7)]">
              <div className="flex items-center gap-3 bg-gain-bg px-4 py-[15px]">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-gain">
                  <svg width="17" height="17" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M2 6.3 4.6 9 10 3.2" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] font-bold tracking-[0.1em] text-gain uppercase">Winning side</span>
                  <span className="mt-[3px] block text-[19px] font-extrabold tracking-[-0.015em] text-ink">{youSideLabel}</span>
                </span>
              </div>
              <div className="border-t border-rule px-4 py-3 text-[12.5px] leading-[1.5] text-muted">The vote upheld @{PROPOSER}&apos;s call.</div>
            </div>

            <div className="flex items-end justify-between gap-3 rounded-[20px] bg-ink px-[18px] py-4">
              <span className="min-w-0">
                <span className="block text-[10.5px] font-bold tracking-[0.1em] text-surface/50 uppercase">You won</span>
                <span className="mt-1.5 block font-mono text-[32px] leading-none font-semibold tracking-[-0.02em] text-surface">
                  {formatSignedTokens(outcome.payout - stake)}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-[12px] leading-[1.5] text-surface/60">
                {formatTokens(stake)} staked
                <br />
                {formatTokens(outcome.payout)} back
              </span>
            </div>

            <div className="overflow-hidden rounded-[20px] border border-hairline bg-surface">
              <div className="flex items-baseline justify-between gap-2.5 border-b border-rule px-4 pt-3 pb-2.5">
                <span className="text-[13px] font-extrabold text-ink">What everyone got</span>
                <span className="font-mono text-[11px] text-faint">
                  {formatTokens(outcome.totalPool)} pool · {outcome.callers.length} won
                </span>
              </div>
              {outcome.callers.map((c) => (
                <div
                  key={c.nickname}
                  className={cn('flex items-center gap-[9px] border-b border-row-rule px-4 py-2.5 last:border-b-0', c.isYou && 'bg-signal-wash shadow-[inset_3px_0_0_var(--color-signal)]')}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tile text-[10px] font-bold text-muted">
                    {(c.isYou ? 'Y' : c.nickname[0]!).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">{c.isYou ? 'You' : `@${c.nickname}`}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    {youSideLabel} {formatTokens(c.amount)}
                  </span>
                  <span className="w-[52px] shrink-0 text-right font-mono text-[12.5px] font-semibold text-gain">{formatSignedTokens(c.payout - c.amount)}</span>
                </div>
              ))}
              <p className="bg-wash px-4 py-[11px] text-[12px] text-faint">Everyone on {sideTitle(otherSide)} lost their stake to the pool.</p>
            </div>
          </div>
        )}

        {/* ---- 5: where things live ---- */}
        {step === 5 && (
          <div>
            <h1 className="text-[25px] leading-[1.15] font-extrabold tracking-[-0.022em] text-ink">Where everything lives</h1>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted">Inside a group, the bar along the bottom looks like this.</p>

            <div className="mt-4 overflow-hidden rounded-[20px] border border-hairline bg-surface px-[18px] pt-3 pb-3.5">
              <div className="flex items-center justify-between">
                {NAV.map((t) =>
                  t.plus ? (
                    <span key="plus" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-signal text-surface shadow-[0_10px_20px_-8px_rgba(45,85,245,0.6)]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  ) : (
                    <span key={t.label} className={cn('flex w-14 flex-col items-center gap-1', t.active ? 'text-signal' : 'text-faint')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={t.active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round" className="h-[21px] w-[21px]">
                        {t.d.map((d) => (
                          <path key={d} d={d} />
                        ))}
                      </svg>
                      <span className={cn('text-[10px]', t.active ? 'font-bold' : 'font-semibold')}>{t.label}</span>
                    </span>
                  )
                )}
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-[18px] border border-hairline bg-surface">
              {[
                ['Markets', 'Everything open, waiting on a call, and settled.'],
                ['Inbox', 'Anything waiting on you, across every group.'],
                ['+', 'Start a market: yes or no, pick a winner, or a number.'],
                ['Group', 'The leaderboard, and what first and last place are playing for.'],
                ['You', 'Your record in this group, your open bets, your name here.'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 border-b border-row-rule px-4 py-3 last:border-b-0">
                  <span className="w-[62px] shrink-0 text-[13px] font-bold text-ink">{k}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-muted text-pretty">{v}</span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[12px] leading-[1.5] text-faint text-pretty">
              This was a demo. Nothing you did here touched a real balance.
            </p>
          </div>
        )}
      </div>

      <StickyFooter>
        {coach && (
          <div key={`coach-${step}`} className="flex animate-demo-fade-up items-start gap-2.5 rounded-[14px] border border-signal-line bg-signal-wash px-[13px] py-[11px]">
            <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-signal font-mono text-[10px] font-semibold text-surface">i</span>
            <p className="text-[12.5px] leading-[1.45] text-signal-ink text-pretty">{coach}</p>
          </div>
        )}
        {step === 0 && <p className="text-center text-[12px] text-faint">Place a bet above to keep going.</p>}
        {step === 1 && <FooterButton onClick={() => setStep(2)}>See who calls it</FooterButton>}
        {step === 2 && <FooterButton onClick={() => setStep(3)}>Challenge this call</FooterButton>}
        {step === 3 && (
          <FooterButton disabled={!vote} onClick={() => setStep(4)}>
            {vote ? 'Lock in my vote' : 'Pick what happened'}
          </FooterButton>
        )}
        {step === 4 && <FooterButton onClick={() => setStep(5)}>One last thing</FooterButton>}
        {step === 5 && (
          <>
            <FooterButton href={isLoggedIn ? '/groups?all=1&startGroup=1' : '/login?mode=signup'}>Start a group</FooterButton>
            <FooterButton tone="outline" href={isLoggedIn ? '/groups/discover' : '/join'}>
              {isLoggedIn ? 'Browse public groups' : 'I have a group code'}
            </FooterButton>
          </>
        )}
      </StickyFooter>

      {ticketOpen && outcome && side && (
        <DemoTicket
          amount={stake}
          label={youSideLabel}
          balanceAfter={DEMO_STARTING_BALANCE - stake}
          onClose={() => {
            setTicketOpen(false);
            setStep(1);
          }}
        />
      )}
    </div>
  );
}

const NAV: { label: string; d: string[]; active?: boolean; plus?: boolean }[] = [
  { label: 'Markets', d: ['M3 17l5-5 3 3 6-7M14 8h5v5'], active: true },
  { label: 'Inbox', d: ['M12 4a5 5 0 0 0-5 5v4l-2 3h14l-2-3V9a5 5 0 0 0-5-5z', 'M10 19a2 2 0 0 0 4 0'] },
  { label: '+', d: [], plus: true },
  { label: 'Group', d: ['M8 20V11M14 20V4M20 20v-7M2 20h20'] },
  { label: 'You', d: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-7 7-7s7 3.1 7 7'] },
];

function LockGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** 5j's ticket, for the demo: same torn card, a fixed "closes in" since nothing real is closing. */
function DemoTicket({ amount, label, balanceAfter, onClose }: { amount: number; label: string; balanceAfter: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas">
      <ScreenHeader title="Bet placed" tile="close" onTile={onClose} right={<span className="text-[12.5px] font-semibold text-muted">Demo</span>} />
      <div className="mx-auto max-w-[430px] px-[22px] pt-5 pb-[140px]">
        <div className="relative rounded-[22px] border border-hairline bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
          <div className="px-5 pt-[22px] pb-[18px]">
            <div className="flex items-center gap-[9px]">
              <span className="flex h-[26px] w-[26px] animate-bet-check-circle items-center justify-center rounded-[9px] bg-signal">
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M2 6.3 4.6 9 10 3.2" />
                </svg>
              </span>
              <span className="text-[11px] font-bold tracking-[0.1em] text-signal uppercase">Your stake is in</span>
            </div>
            <p className="mt-3.5 text-[21px] leading-[1.24] font-extrabold tracking-[-0.022em] text-ink text-pretty">{DEMO_QUESTION}</p>
            <div className="mt-4 flex items-end justify-between gap-3.5">
              <span className="min-w-0">
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">You backed</span>
                <span className="mt-[5px] block text-[24px] font-extrabold tracking-[-0.02em] text-ink">{label}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">Stake</span>
                <span className="mt-1 block font-mono text-[30px] leading-none font-semibold tracking-[-0.03em] text-ink">{formatTokens(amount)}</span>
              </span>
            </div>
          </div>
          <div className="relative h-px border-t-[1.5px] border-dashed border-edge">
            <span className="absolute -top-[9px] -left-[9px] h-[18px] w-[18px] rounded-full border border-hairline bg-canvas" />
            <span className="absolute -top-[9px] -right-[9px] h-[18px] w-[18px] rounded-full border border-hairline bg-canvas" />
          </div>
          <div className="flex px-5 pt-4 pb-[18px]">
            <StatCell first label="Betting shuts" value="2h 15m" tone="signal" flex={1.2} size={14} />
            <StatCell label="Stake" value={formatTokens(amount)} size={14} />
            <StatCell label="Left free" value={formatTokens(balanceAfter)} size={14} />
          </div>
        </div>
        <div className="mt-4 rounded-[18px] border border-hairline bg-surface px-[17px] py-4">
          <p className="text-[13px] font-bold text-ink">What you&apos;ll win isn&apos;t known yet</p>
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted text-pretty">
            Nobody sees the split while betting is open. When it shuts, the pool becomes the price and your return is fixed from it.
          </p>
          <div className="mt-3.5">
            <LoadingAnimation size="sm" />
          </div>
        </div>
      </div>
      <StickyFooter className="z-[61]">
        <FooterButton onClick={onClose}>Skip to betting closing</FooterButton>
      </StickyFooter>
    </div>
  );
}
