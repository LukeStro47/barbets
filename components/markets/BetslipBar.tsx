'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBet } from '@/lib/actions/bets';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { useBetslip } from '@/components/markets/BetslipContext';
import { LockIcon, CloseIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import { formatLine } from '@/lib/units';
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
 * The "Your bet" card and the slim sticky footer under it — slot 5 of the market template, and
 * the only place a stake is ever entered.
 *
 * Used to be a collapsed bar that expanded into a full dark bottom-sheet drawer. The Ledger
 * mockups (4d/4h/4h2/4h3) don't have a drawer at all: the pick/stake form sits directly in the
 * page's own scroll flow as its own card, with just a slim sticky footer (current pick's amount
 * + a submit button) pinned above BottomNav for whoever's scrolled past the card to read the
 * rest of the page. Rebuilt to match that — a real interaction-model change, not a re-skin,
 * done only after confirming that explicitly (see ARCHITECTURE.md's design-decision note).
 */
export function BetslipBar({
  groupId,
  groupName,
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
  /** Only the post-bet confirmation needs it: the ticket names the group the stake was spent in,
   * since that is where the balance it just moved actually lives. */
  groupName: string;
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

  const pick = betslip?.pick ?? null;
  const [betSide, setBetSide] = useState<(typeof sides)[number] | null>(
    (pick?.side as (typeof sides)[number] | undefined) ?? existingSide ?? null
  );
  const [betOptionId, setBetOptionId] = useState<string | null>(pick?.optionId ?? existingOptionId ?? options?.[0]?.id ?? null);
  const defaultAmount = Math.min(balance, roundToFive(seedAmount * 0.05));
  const [betAmount, setBetAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<{ amount: number; label: string } | null>(null);

  // Keeps the card in sync when something *else* on the page primes a pick after this component
  // already mounted — the sticky footer's amount pill just scrolls back to this same card (no
  // pick), but a future caller elsewhere on the page could still prime a specific side/option the
  // way the pre-Ledger explainer cards used to. The useState initializer above only runs once, on
  // first mount, so this effect is what makes a later prime actually take.
  useEffect(() => {
    if (!pick) return;
    if (isMultipleChoice) setBetOptionId(pick.optionId ?? null);
    else setBetSide((pick.side as (typeof sides)[number] | undefined) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  const betAmountNum = betAmount === '' ? 0 : Number(betAmount);
  const balanceAfter = Math.max(0, balance - betAmountNum);
  const hasExisting = existingBets.length > 0;

  const hasPick = isMultipleChoice ? !!betOptionId : !!betSide;
  const conflictsWithExisting =
    hasPick && existingBets.some((b) => (isMultipleChoice ? b.option_id !== betOptionId : b.side !== betSide));
  const blockedByHedgeSetting = !allowHedgedBets && hasExisting && conflictsWithExisting;

  const chipAmounts = [0.01, 0.05, 0.1].map((pct) => roundToFive(seedAmount * pct));

  const selectedLabel = isMultipleChoice ? (options?.find((o) => o.id === betOptionId)?.label ?? '') : (betSide?.toUpperCase() ?? '');
  const lineLabel = market.market_type === 'over_under' && market.line != null ? formatLine(market.line, market.unit) : null;

  const canSubmit = !isPending && betAmountNum >= 1 && betAmountNum <= balance && hasPick && !blockedByHedgeSetting;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await placeBet(groupId, market.id, betAmountNum, isMultipleChoice ? { optionId: betOptionId! } : { side: betSide! });
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmed({ amount: betAmountNum, label: selectedLabel });
    });
  }

  /** Leaves for the group's market list rather than back to this market: the bet is placed, odds
   * stay sealed until close, so there is nothing left to watch here. Still refreshes, so the list
   * and the balance it shows are current when it lands. */
  function dismissConfirmation() {
    setConfirmed(null);
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  return (
    <>
      {/* ---- Inline "Your bet" card (4h) — sits in the page's own scroll flow, not a drawer ---- */}
      <div ref={betslip?.slipRef} className="overflow-hidden rounded-[22px] border-[1.5px] border-dash bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
        <div className="flex items-center justify-between gap-2.5 border-b border-rule bg-[#fafbfc] px-4 py-3">
          <span className="text-[13px] font-extrabold tracking-[-0.01em] text-ink">{hasExisting ? 'Add to your bet' : 'Your bet'}</span>
          <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full border border-[#d9e1ff] bg-signal-tint px-[9px] py-1 text-[10.5px] font-bold whitespace-nowrap text-signal">
            <LockIcon className="h-2.5 w-2.5" />
            Sealed until close
          </span>
        </div>

        <div className="px-[15px] pt-[13px] pb-[15px]">
          {/* 5p's "stake didn't go through" card — money-red is reserved for exactly this kind
              of failure, where the stake genuinely didn't leave the balance (place_bet either
              commits the whole transaction or none of it, so "the error means nothing moved" is
              always true here, not just reassuring copy). */}
          {error && (
            <div className="mb-3 rounded-[16px] border border-alert-line bg-alert-bg p-[14px]">
              <div className="flex items-center gap-[10px]">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-alert">
                  <CloseIcon className="h-[11px] w-[11px] text-surface" />
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">{error}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-muted text-pretty">
                Nothing was staked and nothing was charged.
              </p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="mt-3 w-full rounded-[11px] bg-ink py-[10px] text-center text-[13px] font-bold text-surface"
              >
                Try again
              </button>
            </div>
          )}
          {blockedByHedgeSetting && (
            <p className="mb-3 text-sm font-semibold text-alert">
              This group only allows one side per market, and you already have a bet on the other side. You can still add to
              your existing bet.
            </p>
          )}

          <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">{isMultipleChoice ? 'Pick an option' : 'Pick a side'}</p>
          <div className={cn('mt-2 flex gap-2', isMultipleChoice ? 'flex-col' : undefined)}>
            {isMultipleChoice
              ? (options ?? []).map((o) => (
                  <PickChip key={o.id} selected={betOptionId === o.id} fullWidth onClick={() => setBetOptionId(o.id)}>
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

          <p className="mt-3.5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Your stake</p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-[15px] bg-ink px-[17px] py-[13px]">
            <input
              id="betslip-stake"
              type="number"
              inputMode="numeric"
              min={1}
              max={balance}
              placeholder="0"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[29px] leading-none font-semibold tracking-[-0.02em] text-surface tabular-nums placeholder:text-surface/25 focus:outline-none"
            />
            <span className="shrink-0 font-mono text-[11.5px] whitespace-nowrap text-surface/55">of {formatTokens(balance)} free</span>
          </div>

          <div className="mt-2 flex gap-[7px]">
            {chipAmounts.map((amt) => (
              <QuickAmount key={amt} selected={betAmountNum === amt} disabled={amt < 1 || amt > balance} onClick={() => setBetAmount(String(amt))}>
                {formatTokens(amt)}
              </QuickAmount>
            ))}
            <QuickAmount selected={betAmountNum === balance && balance > 0} disabled={balance < 1} onClick={() => setBetAmount(String(balance))}>
              Max
            </QuickAmount>
          </div>

          {/* Where the design put a payout projection. Odds stay sealed while betting is open
              (get_closed_odds refuses outright until it closes), and a payout figure is a live
              odds readout by another name — anyone could divide their way back to the split. So
              the card commits to the one number it can state honestly: what's left after. */}
          <div className="mt-[11px] flex items-center justify-between gap-2.5 rounded-[12px] border border-rule bg-canvas px-[13px] py-[10px]">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
              {hasPick ? (
                <>
                  {formatTokens(betAmountNum)} on <span className="font-bold text-ink">{selectedLabel}</span>
                </>
              ) : (
                'Pick a side above'
              )}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-faint">{formatTokens(balanceAfter)} left</span>
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="mt-2.5 w-full rounded-[14px] bg-signal py-[14px] text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] transition-colors hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
          >
            {hasPick ? `${hasExisting ? 'Add' : 'Place'} ${formatTokens(betAmountNum)} on ${selectedLabel}` : 'Pick a side to continue'}
          </button>
        </div>
      </div>

      {/* ---- Slim sticky footer — a quick re-bet shortcut for anywhere else on the page ---- */}
      <div aria-hidden="true" className="invisible !m-0 h-[86px]" />
      <div className="fixed inset-x-0 bottom-[var(--bottomnav-height)] z-20 !m-0 border-t border-hairline bg-surface/96 px-[18px] pt-3 pb-[10px] backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center gap-[9px]">
          <button
            type="button"
            onClick={() => betslip?.open()}
            className="flex shrink-0 items-center gap-[7px] rounded-[14px] border-[1.5px] border-signal bg-surface px-[13px] py-[10px] font-mono text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink"
          >
            {formatTokens(betAmountNum)}
            <svg width="9" height="6" viewBox="0 0 10 7" fill="none" className="shrink-0">
              <path d="M1 1.5 5 5.5l4-4" stroke="#2d55f5" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="flex-1 rounded-[14px] bg-signal py-[14px] text-center text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
          >
            {hasPick ? `${hasExisting ? 'Add to' : 'Bet on'} ${selectedLabel}` : 'Pick a side'}
          </button>
        </div>
        <p className="mt-[9px] text-center font-mono text-[11px] text-faint">
          {formatTokens(balance)} free to bet · {formatTokens(balanceAfter)} after this
        </p>
      </div>

      {confirmed && (
        <BetConfirmedOverlay
          amount={confirmed.amount}
          label={confirmed.label}
          marketTitle={market.title}
          groupName={groupName}
          closesAt={market.closes_at}
          balanceAfter={Math.max(0, balance - confirmed.amount)}
          onClose={dismissConfirmation}
        />
      )}
    </>
  );
}

function PickChip({
  selected,
  onClick,
  children,
  fullWidth = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Multiple-choice options stack one per row instead of sitting side by side — a wrapped chip
   * sized to its own text left a ragged gap on one side of the row, so each option spans the
   * full row width whether it's short or long. */
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[46px] items-center justify-center rounded-[13px] border-[1.5px] px-3 py-2 text-[15px] font-bold tracking-[-0.01em]',
        fullWidth ? 'w-full text-left' : 'flex-1 text-center',
        selected ? 'border-signal bg-[#f7f9ff] text-ink shadow-[0_0_0_3px_rgba(45,85,245,0.09)]' : 'border-hairline bg-surface text-muted'
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
        'flex-1 rounded-[11px] border py-2 font-mono text-[12.5px] font-semibold',
        selected ? 'border-[#d9e1ff] bg-signal-tint text-signal' : 'border-hairline bg-surface text-muted',
        disabled && 'opacity-40'
      )}
    >
      {children}
    </button>
  );
}

/**
 * What replaces the inline card once `placeBet` succeeds: the stake as a real torn ticket stub,
 * plus exactly the facts a bettor wants in the two seconds after committing — what they backed,
 * on which market, in which group, when it closes, what they have left.
 *
 * No odds and no projected payout, for the same reason the card above carries none: the split
 * stays sealed while betting is open, and a payout figure is a live odds readout by another name.
 * Dismissing goes to the group's market list rather than back to this market — the bet is done,
 * and the next thing anyone wants is the next market.
 */
/** Mirrors the stake figure's size at short lengths, but a picked option can be a whole option
 * label rather than a number — shrinks it in steps so the full text still fits without an
 * ellipsis swallowing part of what was actually backed. */
function onLabelSizeClass(label: string): string {
  if (label.length <= 10) return 'text-[38px]';
  if (label.length <= 16) return 'text-[28px]';
  if (label.length <= 24) return 'text-[22px]';
  return 'text-[17px]';
}

function BetConfirmedOverlay({
  amount,
  label,
  marketTitle,
  groupName,
  closesAt,
  balanceAfter,
  onClose,
}: {
  amount: number;
  label: string;
  marketTitle: string;
  groupName: string;
  closesAt: string;
  balanceAfter: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-between bg-ink"
      style={{
        padding: 'calc(env(safe-area-inset-top) + 56px) calc(env(safe-area-inset-right) + 24px) calc(env(safe-area-inset-bottom) + 40px) calc(env(safe-area-inset-left) + 24px)',
      }}
    >
      <div className="flex flex-col items-center gap-5">
        <svg width="64" height="64" viewBox="0 0 76 76" fill="none" className="animate-bet-check-circle">
          <circle cx="38" cy="38" r="38" className="fill-signal" />
          <path
            d="M24 39l9 9 19-19"
            className="animate-bet-check-mark"
            stroke="#0c1018"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <div className="text-center">
          <p className="font-display text-[26px] font-extrabold tracking-[-0.01em] text-surface">Bet placed</p>
          <p className="mt-1 text-[13px] font-bold tracking-[0.1em] text-surface/45 uppercase">{groupName}</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm rounded-[20px] bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
        <div className="px-5 pt-5 pb-4">
          <p className="text-[11px] font-extrabold tracking-[0.12em] text-faint uppercase">Your bet</p>
          <p className="mt-2 font-display text-[19px] leading-[1.25] font-extrabold text-ink text-pretty">{marketTitle}</p>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-faint uppercase">Staked</p>
              <p className="mt-1 font-mono text-[38px] leading-none font-extrabold tracking-[-0.02em] text-ink tabular-nums">
                {formatTokens(amount)}
              </p>
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-faint uppercase">On</p>
              <p className={`mt-1 font-display ${onLabelSizeClass(label)} leading-[1.1] font-extrabold tracking-[-0.02em] text-signal-deep text-pretty`}>
                <OptionLabel label={label.toUpperCase()} />
              </p>
            </div>
          </div>
        </div>

        {/* The tear. The notches are circles filled with the backdrop's colour at this height,
            not real cutouts, which no amount of border-radius can produce on a solid card. */}
        <div className="relative h-[22px]">
          <div
            className="absolute top-1/2 right-0 left-0 h-px"
            style={{ backgroundImage: 'repeating-linear-gradient(to right, #cfd6e2 0 6px, transparent 6px 12px)' }}
          />
          <div className="absolute top-1/2 -left-[11px] h-[22px] w-[22px] -translate-y-1/2 rounded-full bg-ink" />
          <div className="absolute top-1/2 -right-[11px] h-[22px] w-[22px] -translate-y-1/2 rounded-full bg-ink" />
        </div>

        <div className="flex px-5 pb-5">
          <div className="flex-1">
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-faint uppercase">Closes in</p>
            <p className="mt-[3px] text-base font-extrabold text-ink font-mono tabular-nums">
              <CountdownTimer target={closesAt} prefix="" />
            </p>
          </div>
          <div className="flex-1 text-right">
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-faint uppercase">Balance after</p>
            <p className="mt-[3px] text-base font-extrabold text-ink font-mono tabular-nums">{formatTokens(balanceAfter)}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
        <p className="text-center text-[13px] leading-[1.45] text-surface/55">
          Nobody sees the odds until betting closes. You can add to this bet any time before then.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full bg-signal py-[15px] text-[15px] font-extrabold text-ink transition-colors hover:bg-signal-deep"
        >
          All markets
        </button>
      </div>
    </div>
  );
}
