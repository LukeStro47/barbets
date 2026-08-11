'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBet } from '@/lib/actions/bets';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { useBetslip } from '@/components/markets/BetslipContext';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import { formatLine } from '@/lib/units';
import { useKeyboardState } from '@/lib/useKeyboardInset';
import type { Market, MarketOption } from '@/lib/actions/markets';

interface ExistingBet {
  side: string | null;
  option_id: string | null;
  amount: number;
}

/** Nearest multiple of 5, floored at 5 so a tiny seed amount never rounds a quick-amount chip down to 0. */
function roundToFive(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

/**
 * The pinned bet slip and the drawer it opens — slot 5 of the market template, and the only
 * place a stake is ever entered.
 *
 * The collapsed bar shows the actual choices rather than a generic "place a bet" affordance:
 * a binary market puts both sides right on the bar, so betting is one tap to the drawer already
 * primed with a side. Neither side gets the accent colour — honey is reserved for the single
 * committing action on screen (Confirm bet), so the UI never nudges anyone toward a side. A
 * multiple-choice market can't fit its options on one row, so it keeps a single "Bet" pill and
 * leans on the "What you can back" card above, whose rows open this same drawer primed.
 */
export function BetslipBar({
  groupId,
  market,
  balance,
  options,
  existingBets = [],
  allowHedgedBets = true,
  seedAmount,
  betCount,
  betVolume,
}: {
  groupId: string;
  market: Market;
  balance: number;
  options: MarketOption[] | null;
  existingBets?: ExistingBet[];
  allowHedgedBets?: boolean;
  /** group_settings.seed_amount — the tokens a new member starts with, used as the base for quick-amount chips. */
  seedAmount: number;
  betCount: number | null;
  betVolume: number | null;
}) {
  const router = useRouter();
  const betslip = useBetslip();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);

  const existingSide = existingBets.find((b) => b.side)?.side as (typeof sides)[number] | undefined;
  const existingOptionId = existingBets.find((b) => b.option_id)?.option_id;

  const [betSide, setBetSide] = useState<(typeof sides)[number]>(existingSide ?? sides[0]);
  const [betOptionId, setBetOptionId] = useState<string | null>(existingOptionId ?? options?.[0]?.id ?? null);
  const defaultAmount = Math.min(balance, roundToFive(seedAmount * 0.05));
  const [betAmount, setBetAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<{ amount: number; label: string } | null>(null);
  const [idleNudge, setIdleNudge] = useState(false);

  const isOpen = betslip?.isOpen ?? false;
  const pick = betslip?.pick ?? null;

  // The provider carries only "which pick was tapped"; the side/option that actually gets
  // submitted still lives here alongside the stake. This is the one wire between them, so a row
  // in the options card and a chip inside the drawer end up setting the same thing.
  useEffect(() => {
    if (!pick) return;
    if (pick.optionId) setBetOptionId(pick.optionId);
    if (pick.side) setBetSide(pick.side as (typeof sides)[number]);
  }, [pick]);

  // The amount input's numeric keyboard pushes this sheet up just enough to reveal the input
  // itself, leaving Confirm flush against the keyboard with no breathing room — pad past it.
  const { visible: keyboardOpen, inset: keyboardInset } = useKeyboardState();

  const betAmountNum = betAmount === '' ? 0 : Number(betAmount);
  const balanceAfter = Math.max(0, balance - betAmountNum);
  const hasExisting = existingBets.length > 0;

  const conflictsWithExisting = existingBets.some((b) => (isMultipleChoice ? b.option_id !== betOptionId : b.side !== betSide));
  const blockedByHedgeSetting = !allowHedgedBets && hasExisting && conflictsWithExisting;

  const chipAmounts = [0.01, 0.05, 0.1].map((pct) => roundToFive(seedAmount * pct));

  const title = hasExisting ? 'Add to your bet' : 'Place your bet';
  const subtitle =
    betCount === null || betCount === 0
      ? 'Be the first to bet'
      : `${betCount} ${betCount === 1 ? 'bet' : 'bets'} · ${formatTokens(betVolume ?? 0)} tokens in`;

  const selectedLabel = isMultipleChoice ? (options?.find((o) => o.id === betOptionId)?.label ?? '') : betSide.toUpperCase();
  const lineLabel = market.market_type === 'over_under' && market.line != null ? formatLine(market.line, market.unit) : null;

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') betslip?.close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, betslip]);

  // A gentle one-off bounce after 10s of nobody touching the page, just
  // enough to draw the eye toward the bar — not a recurring nag. Resets on
  // any interaction, and while the sheet itself is open there's nothing to
  // nudge toward.
  useEffect(() => {
    if (isOpen) return;
    let fired = false;
    let timer: ReturnType<typeof setTimeout>;

    function scheduleNudge() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!fired) {
          fired = true;
          setIdleNudge(true);
        }
      }, 10_000);
    }

    scheduleNudge();
    window.addEventListener('pointerdown', scheduleNudge);
    window.addEventListener('scroll', scheduleNudge, { passive: true });
    window.addEventListener('keydown', scheduleNudge);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', scheduleNudge);
      window.removeEventListener('scroll', scheduleNudge);
      window.removeEventListener('keydown', scheduleNudge);
    };
  }, [isOpen]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await placeBet(groupId, market.id, betAmountNum, isMultipleChoice ? { optionId: betOptionId! } : { side: betSide });
      if (result.error) {
        setError(result.error);
        return;
      }
      betslip?.close();
      setConfirmed({ amount: betAmountNum, label: selectedLabel });
    });
  }

  function dismissConfirmation() {
    setConfirmed(null);
    router.refresh();
  }

  /** The bar's own contents, rendered twice: once for real, once invisibly in normal flow to
   * reserve exactly this height at the end of the page. Sharing one function is what keeps the
   * reserved space honest when the binary and multiple-choice forms differ in height. */
  function barContents() {
    if (isMultipleChoice) {
      return (
        <div className="px-5 pt-3 pb-4">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/25" />
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-extrabold text-paper-white">{title}</p>
              <p className="mt-0.5 text-xs font-semibold text-paper-white/55">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => betslip?.open()}
              className="inline-flex shrink-0 items-center gap-[7px] rounded-full bg-honey-500 px-[18px] py-[11px] text-sm font-extrabold text-espresso-950 transition-colors hover:bg-honey-600"
            >
              Bet
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="px-5 pt-[13px] pb-4">
        <div className="mx-auto max-w-lg">
          <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
            <p className="text-[13px] font-extrabold text-paper-white">{title}</p>
            <p className="shrink-0 text-[11.5px] font-semibold text-paper-white/55">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <SideButton label={sides[0]} onClick={() => betslip?.open({ side: sides[0] })} />
            {lineLabel && (
              <span className="shrink-0 rounded-full bg-white/10 px-[13px] py-2 text-[13.5px] font-extrabold whitespace-nowrap text-paper-white tabular-nums">
                {lineLabel}
              </span>
            )}
            <SideButton label={sides[1]} onClick={() => betslip?.open({ side: sides[1] })} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* In-flow, invisible twin of the bar below — reserves exactly the bar's real rendered
          height at the end of the page, instead of a guessed padding value that drifts out of
          sync with the bar's actual size and leaves a visible gap above it. BottomNavSpacer
          (app/(app)/layout.tsx) separately reserves room for BottomNav itself, which this bar
          now stacks above rather than covering. */}
      <div aria-hidden="true" className="invisible !m-0">
        {barContents()}
      </div>

      {/* Static backing strip, pinned to BottomNav's top edge (not the true screen edge —
          BottomNav itself now occupies that), never animated: the idle-bounce animation below
          translates the whole bar upward, and since the bar itself is what carries the brown
          background, that translation would otherwise uncover BottomNav's own bar for the
          duration of the bounce. This sits behind it at the same color so the strip between the
          bar and the nav always reads as solid brown, bounce or not. */}
      <div aria-hidden="true" className="fixed inset-x-0 bottom-[var(--bottomnav-height)] z-20 !m-0 bg-espresso-900 pb-5" />

      {/* !m-0 on every top-level element here: the parent <main> uses space-y-*, which in
          Tailwind v4 puts margin-bottom on every child except the literal last one — since
          fixed-position elements still receive that margin even though they're out of normal
          flow, a bottom-0 element's rendered box shifts up by exactly the margin, off the true
          screen edge. Explicit here rather than relying on this being the last child, which
          would silently break again if page.tsx's structure ever changes. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-[var(--bottomnav-height)] z-30 !m-0 rounded-t-[20px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 shadow-[0_-14px_28px_-10px_rgba(28,19,13,0.4)]',
          idleNudge && 'animate-betslip-idle-bounce'
        )}
        onAnimationEnd={() => setIdleNudge(false)}
      >
        {barContents()}
      </div>

      {isOpen && <div className="fixed inset-0 z-40 !m-0 bg-espresso-950/45" onClick={() => betslip?.close()} />}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 !m-0 max-h-[85dvh] overflow-y-auto rounded-t-[22px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 pb-[calc(env(safe-area-inset-bottom)+24px)] transition-transform duration-300 ease-out',
          isOpen ? 'translate-y-0' : 'translate-y-full'
        )}
        style={{ paddingBottom: keyboardOpen ? keyboardInset + 16 : undefined }}
        aria-hidden={!isOpen}
      >
        <div className="mx-auto my-3 h-1 w-9 rounded-full bg-white/25" />
        <div className="mx-auto max-w-lg px-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] font-extrabold tracking-[0.1em] text-paper-white/50 uppercase">Your bet</p>
            <button type="button" onClick={() => betslip?.close()} className="text-[13px] font-semibold text-paper-white/60">
              Cancel
            </button>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-danger-100">{error}</p>}
          {blockedByHedgeSetting && (
            <p className="mt-3 text-sm font-semibold text-danger-100">
              This group only allows one side per market, and you already have a bet on the other side. You can still add to
              your existing bet.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {isMultipleChoice
              ? (options ?? []).map((o) => (
                  <PickChip key={o.id} selected={betOptionId === o.id} onClick={() => setBetOptionId(o.id)}>
                    <OptionLabel label={o.label} />
                  </PickChip>
                ))
              : sides.map((s) => (
                  <PickChip key={s} selected={betSide === s} onClick={() => setBetSide(s)}>
                    {s.toUpperCase()}
                    {lineLabel ? ` ${lineLabel}` : ''}
                  </PickChip>
                ))}
          </div>

          {/* Stake reads as the drawn 30px display, but is a real input so free entry lives here
              rather than only in the quick amounts — a group whose seed is 200 needs to be able
              to type 37, and the chips below are derived from that seed rather than fixed. */}
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-white/12 pt-4">
            <label htmlFor="betslip-stake" className="text-[11.5px] font-extrabold tracking-[0.1em] text-paper-white/50 uppercase">
              Stake
            </label>
            <input
              id="betslip-stake"
              type="number"
              inputMode="numeric"
              min={1}
              max={balance}
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              className="w-32 bg-transparent text-right font-display text-[30px] leading-none font-extrabold tracking-[-0.02em] text-paper-white tabular-nums focus:outline-none"
            />
          </div>

          <div className="mt-3 flex gap-2">
            {chipAmounts.map((amt) => (
              <QuickAmount
                key={amt}
                selected={betAmountNum === amt}
                disabled={amt < 1 || amt > balance}
                onClick={() => setBetAmount(String(amt))}
              >
                {formatTokens(amt)}
              </QuickAmount>
            ))}
            <QuickAmount
              selected={betAmountNum === balance && balance > 0}
              disabled={balance < 1}
              onClick={() => setBetAmount(String(balance))}
            >
              Max
            </QuickAmount>
          </div>

          {/* Where the design put a payout projection. Odds stay sealed while betting is open
              (get_closed_odds refuses outright until it closes), and a payout figure is a live
              odds readout by another name — anyone could divide their way back to the split. So
              the slip commits to the one number it can state honestly. */}
          <div className="mt-3.5 flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold text-paper-white/60">
              Betting on <OptionLabel label={selectedLabel.toUpperCase()} className="text-honey-200" />
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-paper-white/60">
              Balance after <strong className="font-extrabold text-honey-200">{formatTokens(balanceAfter)}</strong>
            </span>
          </div>

          <button
            type="button"
            disabled={isPending || betAmountNum < 1 || betAmountNum > balance || (isMultipleChoice && !betOptionId) || blockedByHedgeSetting}
            onClick={submit}
            className="mt-3.5 w-full rounded-full bg-honey-500 px-5 py-3.5 text-[15px] font-extrabold text-espresso-950 transition-colors hover:bg-honey-600 disabled:bg-honey-500/30 disabled:text-espresso-950/40"
          >
            Place bet
          </button>
        </div>
      </div>

      {confirmed && <BetConfirmedOverlay amount={confirmed.amount} label={confirmed.label} onClose={dismissConfirmation} />}
    </>
  );
}

/** One of the two neutral sides on the collapsed binary bar. */
function SideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-full border-[1.5px] border-white/28 bg-white/8 px-2.5 py-[13px] text-[15px] font-extrabold tracking-[0.04em] whitespace-nowrap text-paper-white uppercase transition-colors hover:border-white/50 hover:bg-white/16"
    >
      {label}
    </button>
  );
}

function PickChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border-[1.5px] px-4 py-[9px] text-sm font-extrabold',
        selected ? 'border-honey-500 bg-honey-500 text-espresso-950' : 'border-white/22 bg-white/6 text-paper-white'
      )}
    >
      {children}
    </button>
  );
}

function QuickAmount({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-xl border-[1.5px] py-[11px] text-sm font-extrabold tabular-nums',
        selected ? 'border-honey-500 bg-honey-500 text-espresso-950' : 'border-white/22 bg-white/6 text-paper-white',
        disabled && 'opacity-40'
      )}
    >
      {children}
    </button>
  );
}

function BetConfirmedOverlay({ amount, label, onClose }: { amount: number; label: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 px-8 text-center">
      <svg width="76" height="76" viewBox="0 0 76 76" fill="none" className="animate-bet-check-circle">
        <circle cx="38" cy="38" r="36" className="fill-honey-500" />
        <path
          d="M24 39l9 9 19-19"
          className="animate-bet-check-mark"
          stroke="#1c130d"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <div className="space-y-1.5">
        <p className="font-display text-2xl font-bold text-paper-white">Bet placed</p>
        <p className="text-base text-paper-white/70">
          {formatTokens(amount)} tokens on <OptionLabel label={label.toUpperCase()} />
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full max-w-xs rounded-full bg-honey-500 py-3.5 text-base font-bold text-espresso-950 transition-colors hover:bg-honey-600"
      >
        Close
      </button>
    </div>
  );
}
