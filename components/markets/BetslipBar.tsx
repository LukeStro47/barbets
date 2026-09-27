'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBet } from '@/lib/actions/bets';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { useBetslip } from '@/components/markets/BetslipContext';
import { sideTitle } from '@/components/markets/MarketScreen';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { HeaderTile, StickyFooter, FooterButton } from '@/components/ui/Screen';
import { LoadingAnimation } from '@/components/ui/LoadingAnimation';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import { formatLine, isLineFormatUnit, isPrefixedUnit } from '@/lib/units';
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

/** The quick-amount row's fractions of the group's seed: 25 / 50 / 100 / 250 on the default
 *  1,000 seed, which is exactly the row 4h draws. */
const QUICK_FRACTIONS = [0.025, 0.05, 0.1, 0.25];

/**
 * The only place a stake is ever entered, in the two shapes the mockups draw:
 *
 * - No position yet (4h/4h2/4h3): the "Your bet · Sealed until close" card inline in the page —
 *   pick a side, a dark mono stake field, quick amounts, a summary line, and "Place N on X".
 * - Already holding a position (4d): no card; a sticky footer with an amount pill and "Add to X",
 *   plus "N free to bet · N after this". The pill opens a small stake sheet (and, where the group
 *   allows hedging, a side picker) rather than leaving the stake fixed.
 *
 * A successful bet hands over to the 5j ticket.
 */
export function BetslipBar({
  groupId,
  groupName,
  groupAvatarKey,
  market,
  balance,
  options,
  existingBets = [],
  allowHedgedBets = true,
  seedAmount,
  betVolume,
  bonusPool = 0,
}: {
  groupId: string;
  groupName: string;
  groupAvatarKey?: string | null;
  market: Market;
  balance: number;
  options: MarketOption[] | null;
  existingBets?: ExistingBet[];
  allowHedgedBets?: boolean;
  /** group_settings.seed_amount — the base for quick-amount chips. */
  seedAmount: number;
  betCount?: number | null;
  betVolume: number | null;
  bonusPool?: number;
}) {
  const router = useRouter();
  const betslip = useBetslip();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const isOverUnder = market.market_type === 'over_under';
  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);

  const existingSide = existingBets.find((b) => b.side)?.side as (typeof sides)[number] | undefined;
  const existingOptionId = existingBets.find((b) => b.option_id)?.option_id;
  const hasExisting = existingBets.length > 0;

  const pick = betslip?.pick ?? null;
  const [betSide, setBetSide] = useState<(typeof sides)[number] | null>(
    (pick?.side as (typeof sides)[number] | undefined) ?? existingSide ?? null
  );
  const [betOptionId, setBetOptionId] = useState<string | null>(pick?.optionId ?? existingOptionId ?? null);
  const chipAmounts = QUICK_FRACTIONS.map((pct) => roundToFive(seedAmount * pct));
  const defaultAmount = Math.min(balance, hasExisting ? chipAmounts[3] : chipAmounts[2]);
  const [betAmount, setBetAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<{ amount: number; label: string; betId: string; placedAt: string } | null>(null);
  const [stakeSheetOpen, setStakeSheetOpen] = useState(false);

  useEffect(() => {
    if (!pick) return;
    if (isMultipleChoice) setBetOptionId(pick.optionId ?? null);
    else setBetSide((pick.side as (typeof sides)[number] | undefined) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  const betAmountNum = betAmount === '' ? 0 : Number(betAmount);
  const balanceAfter = Math.max(0, balance - betAmountNum);

  const hasPick = isMultipleChoice ? !!betOptionId : !!betSide;
  const conflictsWithExisting =
    hasPick && existingBets.some((b) => (isMultipleChoice ? b.option_id !== betOptionId : b.side !== betSide));
  const blockedByHedgeSetting = !allowHedgedBets && hasExisting && conflictsWithExisting;

  const lineText = isOverUnder && market.line != null ? formatLine(market.line, market.unit) : null;
  // The line's number on its own, for "Over 4.5" (4h3) — the unit is stated once, in "The line".
  const lineNumber =
    isOverUnder && market.line != null
      ? isLineFormatUnit(market.unit) || isPrefixedUnit(market.unit)
        ? formatLine(market.line, market.unit)
        : String(market.line)
      : null;

  const selectedLabel = isMultipleChoice
    ? (options?.find((o) => o.id === betOptionId)?.label ?? '')
    : betSide
      ? `${sideTitle(betSide)}${lineNumber ? ` ${lineNumber}` : ''}`
      : '';
  // The CTA names the side without the line ("Place 100 on Over"), the summary with it.
  const ctaLabel = isMultipleChoice ? selectedLabel : betSide ? sideTitle(betSide) : '';

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
      setStakeSheetOpen(false);
      setConfirmed({
        amount: betAmountNum,
        label: selectedLabel,
        betId: (result.data as { id?: string } | undefined)?.id ?? market.id,
        placedAt: (result.data as { created_at?: string } | undefined)?.created_at ?? new Date().toISOString(),
      });
    });
  }

  /** 5j's footer is "Back to the markets": the bet is placed and odds stay sealed, so the next
   *  thing anyone wants is the next market. Refreshes so the list and balance are current. */
  function dismissConfirmation() {
    setConfirmed(null);
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  const stakeControls = (
    <>
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
        <QuickAmount sans selected={betAmountNum === balance && balance > 0} disabled={balance < 1} onClick={() => setBetAmount(String(balance))}>
          Max
        </QuickAmount>
      </div>
    </>
  );

  const pickControls = (
    <>
      {isOverUnder && lineText && (
        <>
          <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">The line</p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-[15px] border border-rule bg-canvas px-[15px] py-[11px]">
            <LineFigure line={market.line!} unit={market.unit} />
            <span className="text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Over / Under</span>
          </div>
        </>
      )}
      <p className={cn('text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase', isOverUnder && lineText && 'mt-3.5')}>
        {isMultipleChoice ? 'Pick a winner' : 'Pick a side'}
      </p>
      {isMultipleChoice ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {(options ?? []).map((o) => {
            const on = betOptionId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setBetOptionId(o.id)}
                className={cn(
                  'flex w-full items-center gap-[11px] rounded-[14px] border-[1.5px] px-3.5 py-[11px] text-left',
                  on ? 'border-signal bg-signal-wash' : 'border-hairline bg-surface'
                )}
              >
                {on ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M2 6.3 4.6 9 10 3.2" />
                    </svg>
                  </span>
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border-2 border-dash" />
                )}
                <span className="min-w-0 flex-1 text-[15px] font-bold text-ink">
                  <OptionLabel label={o.label} />
                </span>
                {on && <span className="shrink-0 text-[11px] font-bold text-signal">Your pick</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          {sides.map((s) => {
            const on = betSide === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setBetSide(s)}
                className={cn(
                  'flex min-h-[46px] flex-1 items-center justify-center gap-[7px] rounded-[13px] border-[1.5px] text-[15px] font-extrabold tracking-[-0.01em]',
                  on ? 'border-signal bg-signal-wash text-ink shadow-[0_0_0_3px_rgba(45,85,245,0.09)]' : 'border-hairline bg-surface text-muted'
                )}
              >
                {sideTitle(s)}
                {lineNumber && <span className={cn('font-mono text-[13px] font-semibold', on ? 'text-signal' : 'text-faint')}>{lineNumber}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const errorCard = error && (
    // 5p's "stake didn't go through": the first line says what happened to the credits.
    // place_bet commits the whole transaction or none of it, so "nothing moved" is always true.
    <div className="mb-3 rounded-2xl border border-alert-line bg-alert-bg px-[15px] py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-alert">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">Your {formatTokens(betAmountNum)} didn&apos;t leave your balance</span>
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-muted text-pretty">{error} Nothing was staked and nothing was charged.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={submit} className="flex-1 rounded-[11px] bg-ink py-2.5 text-center text-[13px] font-bold text-surface">
          Try again
        </button>
        <button
          type="button"
          onClick={() => setError(null)}
          className="flex-1 rounded-[11px] border border-hairline bg-surface py-2.5 text-center text-[13px] font-bold text-muted"
        >
          Not now
        </button>
      </div>
    </div>
  );

  const hedgeNote = blockedByHedgeSetting && (
    <p className="mt-3 text-[12.5px] font-semibold text-alert">This group allows one side per market. You can still add to your existing bet.</p>
  );

  return (
    <>
      {!hasExisting ? (
        // ---- 4h / 4h2 / 4h3: the inline "Your bet" card ----
        <div
          ref={betslip?.slipRef}
          className="overflow-hidden rounded-[22px] border-[1.5px] border-edge bg-surface shadow-[0_10px_26px_-18px_rgba(12,16,24,0.5)]"
        >
          <div className="flex items-center justify-between gap-2.5 border-b border-rule bg-wash px-4 py-3">
            <span className="text-[13px] font-extrabold tracking-[-0.01em] text-ink">Your bet</span>
            <span className="inline-flex shrink-0 items-center gap-[5px] rounded-full border border-signal-edge bg-signal-tint px-[9px] py-1 text-[10.5px] font-bold whitespace-nowrap text-signal">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Sealed until close
            </span>
          </div>
          <div className="px-[15px] pt-[13px] pb-[15px]">
            {errorCard}
            {pickControls}
            {stakeControls}
            <div className="mt-[11px] flex items-center justify-between gap-2.5 rounded-xl border border-rule bg-canvas px-[13px] py-2.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.4] text-muted">
                {hasPick ? (
                  <>
                    {formatTokens(betAmountNum)} on{' '}
                    <span className="font-bold text-ink">
                      <OptionLabel label={selectedLabel} />
                    </span>
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
              className="mt-2.5 w-full rounded-[14px] bg-signal py-3.5 text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] transition-colors hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
            >
              {isPending ? 'Placing your bet' : hasPick ? `Place ${formatTokens(betAmountNum)} on ${ctaLabel}` : 'Pick a side to continue'}
            </button>
          </div>
        </div>
      ) : (
        // ---- 4d: holding a position, add to it from the footer ----
        <>
          {stakeSheetOpen && (
            <>
              <div className="fixed inset-0 z-40 animate-bottomnav-scrim-in bg-[rgba(12,16,24,0.34)]" onClick={() => setStakeSheetOpen(false)} />
              <div className="fixed inset-x-0 bottom-0 z-40 animate-bottomnav-sheet-up rounded-t-[26px] bg-surface px-[18px] pt-5 pb-[calc(max(28px,env(safe-area-inset-bottom))+118px)] shadow-[0_-20px_40px_-18px_rgba(12,16,24,0.4)]">
                <div className="mx-auto max-w-[430px]">
                  {errorCard}
                  {allowHedgedBets && pickControls}
                  {stakeControls}
                  {hedgeNote}
                </div>
              </div>
            </>
          )}
          <StickyFooter className="z-50">
            {!stakeSheetOpen && errorCard}
            <div className="flex items-center gap-[9px]">
              <button
                type="button"
                onClick={() => setStakeSheetOpen((o) => !o)}
                aria-expanded={stakeSheetOpen}
                className="flex shrink-0 items-center gap-[7px] rounded-[14px] border-[1.5px] border-signal bg-surface px-[13px] py-2.5"
              >
                <span className="font-mono text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">{formatTokens(betAmountNum)}</span>
                <svg width="9" height="6" viewBox="0 0 10 7" fill="none" stroke="#2d55f5" strokeWidth="1.9" strokeLinecap="round" className={cn('transition-transform', stakeSheetOpen && 'rotate-180')}>
                  <path d="M1 1.5 5 5.5l4-4" />
                </svg>
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={submit}
                className="flex-1 rounded-[14px] bg-signal py-3.5 text-center text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
              >
                {isPending ? 'Placing your bet' : hasPick ? `Add to ${ctaLabel}` : 'Pick a side'}
              </button>
            </div>
            <p className="text-center font-mono text-[11px] text-faint">
              {formatTokens(balance)} free to bet · {formatTokens(balanceAfter)} after this
            </p>
          </StickyFooter>
        </>
      )}

      {confirmed && (
        <BetTicket
          amount={confirmed.amount}
          label={confirmed.label}
          marketTitle={market.title}
          groupName={groupName}
          groupAvatarKey={groupAvatarKey ?? null}
          closesAt={market.closes_at}
          pool={(betVolume ?? 0) + bonusPool + confirmed.amount}
          balanceAfter={Math.max(0, balance - confirmed.amount)}
          betId={confirmed.betId}
          placedAt={confirmed.placedAt}
          onClose={dismissConfirmation}
        />
      )}
    </>
  );
}

/** "4.5 pints": the number big and mono, the unit as a word beside it. Date/time and currency
 *  lines read as one token, so they render whole. */
function LineFigure({ line, unit }: { line: number; unit: string | null }) {
  const whole = isLineFormatUnit(unit) || isPrefixedUnit(unit) || !unit;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[27px] leading-none font-semibold tracking-[-0.02em] text-ink">{whole ? formatLine(line, unit) : line}</span>
      {!whole && <span className="text-[13px] font-bold text-muted">{unit}</span>}
    </span>
  );
}

function QuickAmount({
  selected,
  disabled,
  onClick,
  sans,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  /** "Max" is a word, not a figure — sans, per rule 3. */
  sans?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-[11px] border py-2 text-center text-[12.5px]',
        sans ? 'font-sans' : 'font-mono',
        selected ? 'border-signal-edge bg-signal-tint font-bold text-signal' : 'border-hairline bg-surface font-semibold text-muted',
        disabled && 'opacity-40'
      )}
    >
      {children}
    </button>
  );
}

/** "WW-4417": the group's initials plus four digits drawn from the bet's own id, so the reference
 *  on the ticket is stable for this bet without a stored ticket number. */
function ticketRef(groupName: string, betId: string): string {
  const letters = groupName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .filter((c) => /[A-Z0-9]/.test(c))
    .slice(0, 2)
    .join('')
    .padEnd(2, 'B');
  const digits = String(parseInt(betId.replace(/-/g, '').slice(-6), 16) % 10000).padStart(4, '0');
  return `${letters}-${digits}`;
}

function ticketStamp(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${month}, ${time}`;
}

/**
 * 5j: the ticket a bet returns. A full screen, light: a close-tile header naming the group, the
 * stake as a torn ticket (side, stake, then under the perforation when betting shuts, the pool,
 * and what's left free), then the one thing a bettor wonders next: what it'll win, which isn't
 * known until the pool sets the price. No odds, no projected payout — the split stays sealed.
 */
function BetTicket({
  amount,
  label,
  marketTitle,
  groupName,
  groupAvatarKey,
  closesAt,
  pool,
  balanceAfter,
  betId,
  placedAt,
  onClose,
}: {
  amount: number;
  label: string;
  marketTitle: string;
  groupName: string;
  groupAvatarKey: string | null;
  closesAt: string;
  pool: number;
  balanceAfter: number;
  betId: string;
  placedAt: string;
  onClose: () => void;
}) {
  const shortGroup = groupName.split(/\s+/)[0] ?? groupName;
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas">
      <header className="sticky top-0 z-10 border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="mx-auto flex max-w-[430px] items-center gap-[11px] px-3.5 pb-[11px]">
          <HeaderTile kind="close" onClick={onClose} />
          <span className="min-w-0 flex-1 text-[15px] font-extrabold tracking-[-0.015em] text-ink">Bet placed</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-muted">
            <GroupAvatar name={groupName} avatarKey={groupAvatarKey} className="h-5 w-5 text-[8px]" fallbackClassName="bg-ink text-on-ink" />
            {shortGroup}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[430px] px-[22px] pt-5 pb-[140px]">
        <div className="relative rounded-[22px] border border-hairline bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
          <div className="px-5 pt-[22px] pb-[18px]">
            <div className="flex items-center gap-[9px]">
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[9px] bg-signal animate-bet-check-circle">
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M2 6.3 4.6 9 10 3.2" />
                </svg>
              </span>
              <span className="text-[11px] font-bold tracking-[0.1em] text-signal uppercase">Your stake is in</span>
            </div>
            <p className="mt-3.5 text-[21px] leading-[1.24] font-extrabold tracking-[-0.022em] text-ink text-pretty">{marketTitle}</p>
            <div className="mt-4 flex items-end justify-between gap-3.5">
              <span className="min-w-0">
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">You backed</span>
                <span className="mt-[5px] block text-[24px] font-extrabold tracking-[-0.02em] text-ink text-pretty">
                  <OptionLabel label={label} />
                </span>
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

          <div className="px-5 pt-4 pb-[18px]">
            <div className="flex">
              <span className="min-w-0" style={{ flex: 1.2 }}>
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">Betting shuts</span>
                <span className="mt-1 block font-mono text-[14px] font-semibold text-signal">
                  <CountdownTimer target={closesAt} prefix="" />
                </span>
              </span>
              <span className="min-w-0 flex-1 border-l border-rule pl-3.5">
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">Pool</span>
                <span className="mt-1 block font-mono text-[14px] font-semibold text-ink">{formatTokens(pool)}</span>
              </span>
              <span className="min-w-0 flex-1 border-l border-rule pl-3.5">
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">Left free</span>
                <span className="mt-1 block font-mono text-[14px] font-semibold text-ink">{formatTokens(balanceAfter)}</span>
              </span>
            </div>
            <p className="mt-4 border-t border-rule pt-[13px] font-mono text-[11.5px] tracking-[0.06em] text-faint">
              TICKET {ticketRef(groupName, betId)} · {ticketStamp(placedAt)}
            </p>
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
        <FooterButton tone="ink" onClick={onClose}>
          Back to the markets
        </FooterButton>
      </StickyFooter>
    </div>
  );
}
