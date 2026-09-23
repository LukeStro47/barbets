'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBet } from '@/lib/actions/bets';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
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

  // Nullable, because the line ticket's "Pick a side" opens this with nothing chosen. Every other
  // opener names a side, so in practice null is only ever on screen for that one entry point.
  const [betSide, setBetSide] = useState<(typeof sides)[number] | null>(existingSide ?? null);
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
  // An empty pick object clears the selection rather than leaving the last one in place — that is
  // how "Pick a side" opens the drawer neutral. Omitting the argument entirely doesn't change
  // `pick`, so this doesn't re-run and the previous choice survives (what the Bet pill wants).
  useEffect(() => {
    if (!pick) return;
    if (isMultipleChoice) setBetOptionId(pick.optionId ?? null);
    else setBetSide((pick.side as (typeof sides)[number] | undefined) ?? null);
  }, [pick]);

  // The amount input's numeric keyboard pushes this sheet up just enough to reveal the input
  // itself, leaving Confirm flush against the keyboard with no breathing room — pad past it.
  const { visible: keyboardOpen, inset: keyboardInset } = useKeyboardState();

  const betAmountNum = betAmount === '' ? 0 : Number(betAmount);
  const balanceAfter = Math.max(0, balance - betAmountNum);
  const hasExisting = existingBets.length > 0;

  // Nothing picked yet can't conflict with anything — without this guard the hedge warning fires
  // the moment the drawer opens neutral for someone who already has a bet.
  const hasPick = isMultipleChoice ? !!betOptionId : !!betSide;
  const conflictsWithExisting =
    hasPick && existingBets.some((b) => (isMultipleChoice ? b.option_id !== betOptionId : b.side !== betSide));
  const blockedByHedgeSetting = !allowHedgedBets && hasExisting && conflictsWithExisting;

  const chipAmounts = [0.01, 0.05, 0.1].map((pct) => roundToFive(seedAmount * pct));

  const title = hasExisting ? 'Add to your bet' : 'Place your bet';
  const subtitle =
    betCount === null || betCount === 0
      ? 'Be the first to bet'
      : `${betCount} ${betCount === 1 ? 'bet' : 'bets'} · ${formatTokens(betVolume ?? 0)} tokens in`;

  const selectedLabel = isMultipleChoice ? (options?.find((o) => o.id === betOptionId)?.label ?? '') : (betSide?.toUpperCase() ?? '');
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
      const result = await placeBet(groupId, market.id, betAmountNum, isMultipleChoice ? { optionId: betOptionId! } : { side: betSide! });
      if (result.error) {
        setError(result.error);
        return;
      }
      betslip?.close();
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

  /** The bar's own contents, rendered twice: once for real, once invisibly in normal flow to
   * reserve exactly this height at the end of the page. Sharing one function is what keeps the
   * reserved space honest when the binary and multiple-choice forms differ in height. */
  function barContents() {
    if (isMultipleChoice) {
      return (
        <div className="px-[18px] pt-3 pb-7">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/25" />
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-extrabold text-white">{title}</p>
              <p className="mt-0.5 text-xs font-semibold text-white/55">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => betslip?.open()}
              className="inline-flex shrink-0 items-center gap-[7px] rounded-[14px] bg-signal px-[18px] py-[11px] text-sm font-bold text-white shadow-[var(--elevation-cta)] transition-colors hover:bg-signal-deep"
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
      <div className="px-[18px] pt-3 pb-7">
        <div className="mx-auto max-w-lg">
          <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
            <p className="text-[13px] font-extrabold text-white">{title}</p>
            <p className="shrink-0 text-[11.5px] font-semibold text-white/55">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <SideButton label={sides[0]} onClick={() => betslip?.open({ side: sides[0] })} />
            {lineLabel && (
              <span className="shrink-0 rounded-[14px] bg-white/10 px-[13px] py-2 font-mono text-[13.5px] font-semibold whitespace-nowrap text-white">
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
      <div aria-hidden="true" className="fixed inset-x-0 bottom-[var(--bottomnav-height)] z-20 !m-0 bg-ink pb-5" />

      {/* !m-0 on every top-level element here: the parent <main> uses space-y-*, which in
          Tailwind v4 puts margin-bottom on every child except the literal last one — since
          fixed-position elements still receive that margin even though they're out of normal
          flow, a bottom-0 element's rendered box shifts up by exactly the margin, off the true
          screen edge. Explicit here rather than relying on this being the last child, which
          would silently break again if page.tsx's structure ever changes. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-[var(--bottomnav-height)] z-30 !m-0 rounded-t-[24px] border-t border-white/10 bg-ink shadow-[var(--elevation-sheet)]',
          idleNudge && 'animate-betslip-idle-bounce'
        )}
        onAnimationEnd={() => setIdleNudge(false)}
      >
        {barContents()}
      </div>

      {isOpen && <div className="fixed inset-0 z-40 !m-0 bg-ink/45" onClick={() => betslip?.close()} />}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 !m-0 max-h-[85dvh] overflow-y-auto rounded-t-[26px] border-t border-white/10 bg-ink pb-[calc(env(safe-area-inset-bottom)+24px)] shadow-[var(--elevation-sheet)] transition-transform duration-300 ease-out',
          isOpen ? 'translate-y-0' : 'translate-y-full'
        )}
        // The keyboard's height is *added* to the sheet's normal bottom padding, never swapped
        // in for it. `keyboardOpen` is focus-driven, so it stays true while the field is focused
        // with the keyboard swiped away — and on the WebViews that shrink the layout viewport,
        // `keyboardInset` reads ~0 the whole time regardless. Overriding the padding outright in
        // that state dropped the sheet's floor to a bare 16px, which is why Place bet sat lower
        // than it does at rest until you blurred the field.
        style={{
          paddingBottom: keyboardOpen && keyboardInset > 0 ? `calc(env(safe-area-inset-bottom) + 24px + ${keyboardInset}px)` : undefined,
        }}
        aria-hidden={!isOpen}
      >
        <div className="mx-auto my-3 h-1 w-9 rounded-full bg-white/25" />
        <div className="mx-auto max-w-lg px-[18px]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] font-extrabold tracking-[0.1em] text-white/50 uppercase">Your bet</p>
            <button type="button" onClick={() => betslip?.close()} className="text-[13px] font-semibold text-white/60">
              Cancel
            </button>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-alert-bg">{error}</p>}
          {blockedByHedgeSetting && (
            <p className="mt-3 text-sm font-semibold text-alert-bg">
              This group only allows one side per market, and you already have a bet on the other side. You can still add to
              your existing bet.
            </p>
          )}

          <div className={cn('mt-3 flex gap-2', isMultipleChoice ? 'flex-col' : 'flex-wrap')}>
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

          {/* A real, obviously-editable field, not a display that happens to accept typing. The
              quick amounts below are shortcuts into it — they're derived from the group's seed,
              so they can't cover every group, and someone who wants to stake 37 must be able to
              just say 37. The field is the control; the chips fill it in. */}
          <div className="mt-4 border-t border-white/12 pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="betslip-stake" className="text-[11.5px] font-extrabold tracking-[0.1em] text-white/50 uppercase">
                Stake
              </label>
              <span className="font-mono text-[11.5px] font-semibold text-white/45">You have {formatTokens(balance)}</span>
            </div>
            <div className="relative mt-2">
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
                className="w-full rounded-[14px] border border-white/22 bg-white/6 py-3 pr-[86px] pl-4 font-mono text-[30px] leading-none font-semibold tracking-[-0.02em] text-white placeholder:text-white/25 focus:border-signal focus:outline-none"
              />
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs font-semibold text-white/50">
                tokens
              </span>
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
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
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/60">
              {hasPick ? (
                <>
                  Betting on <OptionLabel label={selectedLabel.toUpperCase()} className="text-on-ink" />
                </>
              ) : (
                <span className="text-on-ink">Pick a side above</span>
              )}
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-white/60">
              Balance after <strong className="font-mono font-semibold text-on-ink">{formatTokens(balanceAfter)}</strong>
            </span>
          </div>

          <button
            type="button"
            disabled={isPending || betAmountNum < 1 || betAmountNum > balance || !hasPick || blockedByHedgeSetting}
            onClick={submit}
            className="mt-3.5 w-full rounded-[14px] bg-signal px-5 py-[15px] text-[15px] font-bold text-white shadow-[var(--elevation-cta)] transition-colors hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
          >
            Place bet
          </button>
        </div>
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

/** One of the two neutral sides on the collapsed binary bar. */
function SideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-[14px] border border-white/28 bg-white/8 px-2.5 py-[13px] text-[15px] font-bold tracking-[0.04em] whitespace-nowrap text-white uppercase transition-colors hover:border-white/50 hover:bg-white/16"
    >
      {label}
    </button>
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
  /** Multiple-choice options stack one per row instead of wrapping as inline chips — a wrapped
   * chip sized to its own text left a ragged gap on one side of the row, so each option spans
   * the full row width whether it's short or long. */
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[14px] border px-4 py-[9px] text-sm font-bold',
        fullWidth ? 'w-full text-left' : 'text-center',
        selected ? 'border-signal bg-signal text-white' : 'border-white/22 bg-white/6 text-white'
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
        'flex-1 rounded-[14px] border py-[11px] font-mono text-sm font-semibold',
        selected ? 'border-signal bg-signal text-white' : 'border-white/22 bg-white/6 text-white',
        disabled && 'opacity-40'
      )}
    >
      {children}
    </button>
  );
}

/**
 * What replaces the drawer once `placeBet` succeeds: a dark torn ticket stub, plus exactly the
 * facts a bettor wants in the two seconds after committing — what they backed, on which market,
 * in which group, when it closes, what they have left.
 *
 * No odds and no projected payout, for the same reason the slip above carries none: the split
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
      className="fixed inset-0 z-[60] flex flex-col justify-between bg-canvas"
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
            stroke="#ffffff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <div className="text-center">
          <p className="text-[26px] font-extrabold tracking-[-0.02em] text-ink">Bet placed</p>
          <p className="mt-1 text-[13px] font-bold tracking-[0.1em] text-faint uppercase">{groupName}</p>
        </div>
      </div>

      {/* Dark ticket stub — ink ground, dashed tear, mono figures. */}
      <div className="mx-auto w-full max-w-sm rounded-[24px] bg-ink">
        <div className="px-5 pt-5 pb-4">
          <p className="text-[11px] font-extrabold tracking-[0.12em] text-white/40 uppercase">Your bet</p>
          <p className="mt-2 text-[19px] leading-[1.25] font-extrabold text-white text-pretty">{marketTitle}</p>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-white/40 uppercase">Staked</p>
              <p className="mt-1 font-mono text-[38px] leading-none font-semibold tracking-[-0.02em] text-white">
                {formatTokens(amount)}
              </p>
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-white/40 uppercase">On</p>
              <p className={`mt-1 font-mono ${onLabelSizeClass(label)} leading-[1.1] font-semibold tracking-[-0.02em] text-on-ink text-pretty`}>
                <OptionLabel label={label.toUpperCase()} />
              </p>
            </div>
          </div>
        </div>

        {/* The tear. Notches are circles filled with the canvas behind the ticket. */}
        <div className="relative h-[22px]">
          <div
            className="absolute top-1/2 right-0 left-0 h-px"
            style={{ backgroundImage: 'repeating-linear-gradient(to right, rgba(255,255,255,.26) 0 6px, transparent 6px 12px)' }}
          />
          <div className="absolute top-1/2 -left-[11px] h-[22px] w-[22px] -translate-y-1/2 rounded-full bg-canvas" />
          <div className="absolute top-1/2 -right-[11px] h-[22px] w-[22px] -translate-y-1/2 rounded-full bg-canvas" />
        </div>

        <div className="flex px-5 pb-5">
          <div className="flex-1">
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-white/40 uppercase">Closes in</p>
            <p className="mt-[3px] font-mono text-base font-semibold text-white">
              <CountdownTimer target={closesAt} prefix="" />
            </p>
          </div>
          <div className="flex-1 text-right">
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-white/40 uppercase">Balance after</p>
            <p className="mt-[3px] font-mono text-base font-semibold text-white">{formatTokens(balanceAfter)}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
        <p className="text-center text-[13px] leading-[1.45] text-muted">
          Nobody sees the odds until betting closes. You can add to this bet any time before then.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-[14px] bg-signal py-[15px] text-[15px] font-bold text-white shadow-[var(--elevation-cta)] transition-colors hover:bg-signal-deep"
        >
          All markets
        </button>
      </div>
    </div>
  );
}
