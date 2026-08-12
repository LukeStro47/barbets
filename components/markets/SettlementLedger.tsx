'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Mention } from '@/components/ui/Mention';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ChevronRightIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/formatNumber';
import type { PayoutBreakdown } from '@/lib/actions/markets';
import type { RevealBet } from '@/components/markets/RevealSummary';

type Mode = 'paid' | 'refunded' | 'split';

interface Settlement {
  mode: Mode;
  /** Real tokens the bettors put in. */
  staked: number;
  /** Bonus tokens the market absorbed from elsewhere, derived rather than read: markets.bonus_pool
   *  is zeroed the moment a market resolves, but finalize_market guarantees the payouts (or the
   *  payout_breakdown) account for the pool exactly, so the difference from the stakes is it. */
  bonusIn: number;
  /** Everything the market had to hand out. */
  pool: number;
  /** Stakes on the side/option that actually won. */
  winningPool: number;
  /** The flooring remainder, and the bet it landed on. */
  dust: number;
  dustBet: RevealBet | null;
}

/**
 * Reconstructs finalize_market()'s arithmetic from what it left behind on the bets, so the
 * ledger explains real numbers rather than restating the rule in the abstract. Nothing here is
 * a second implementation of the payout: the payouts are read, and only the *base* payout is
 * recomputed, purely to work out which winner the dust landed on.
 */
function computeSettlement(bets: RevealBet[], breakdown: PayoutBreakdown | null | undefined, refundish: boolean): Settlement {
  const staked = bets.reduce((sum, b) => sum + b.amount, 0);

  // Nobody predicted it and the group splits the pool instead of refunding: every payout is 0,
  // so the breakdown is the only record of the pool's size.
  if (breakdown) {
    const pool =
      breakdown.creator_cut + breakdown.endorser_cut + breakdown.other_markets_cut + breakdown.held_in_group_pool;
    return { mode: 'split', staked, bonusIn: Math.max(pool - staked, 0), pool, winningPool: 0, dust: 0, dustBet: null };
  }

  // Void, or nobody predicted it with the split setting off: every stake comes straight back,
  // nothing is divided, so there is no rounding and no remainder.
  if (refundish) {
    return { mode: 'refunded', staked, bonusIn: 0, pool: staked, winningPool: 0, dust: 0, dustBet: null };
  }

  const winners = bets.filter((b) => b.isWinner);
  const winningPool = winners.reduce((sum, b) => sum + b.amount, 0);
  // sum(payouts) == total_pool + bonus_pool exactly, by construction.
  const pool = bets.reduce((sum, b) => sum + (b.payout ?? 0), 0);

  let dust = 0;
  let dustBet: RevealBet | null = null;
  if (winningPool > 0) {
    const bases = winners.map((b) => Math.floor((b.amount * pool) / winningPool));
    dust = pool - bases.reduce((sum, base) => sum + base, 0);
    // The dust holder is whoever was paid more than the formula alone gives them, which is
    // steadier than re-deriving the biggest-stake / earliest / lowest-id tie-break here.
    dustBet = winners.find((b, i) => (b.payout ?? 0) > bases[i]) ?? null;
  }

  return { mode: 'paid', staked, bonusIn: Math.max(pool - staked, 0), pool, winningPool, dust, dustBet };
}

function Row({
  label,
  value,
  tone = 'plain',
  divided,
}: {
  label: React.ReactNode;
  value: string;
  tone?: 'plain' | 'bonus' | 'total';
  divided?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${divided ? 'border-t border-espresso-50 pt-2' : ''}`}>
      <span className={tone === 'total' ? 'text-[13.5px] font-bold text-espresso-900' : 'text-[13.5px] text-espresso-500'}>
        {label}
      </span>
      <span
        className={
          tone === 'total'
            ? 'text-base font-extrabold text-espresso-950 tabular-nums'
            : tone === 'bonus'
              ? 'text-sm font-extrabold text-honey-700 tabular-nums'
              : 'text-sm font-extrabold text-espresso-900 tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">{children}</p>;
}

/**
 * The one place a resolved market says where every token went, opened from a single row on the
 * reveal page. It replaced two cards that each stated one fragment of the same story (a 🎁 note
 * about carried bonus tokens, and a "nobody predicted this" breakdown) plus an always-expanded
 * list of bets: three surfaces for one question, none of which said how the numbers were
 * reached. The rounding rule in particular has no other home, and a market where the biggest
 * winner is paid a token more than the formula gives them looks like a bug until it is written
 * down somewhere.
 */
export function SettlementLedger({
  bets,
  payoutBreakdown,
  carriedBonusPool,
  creatorNickname,
  sponsorNickname,
  voided,
  refundish,
}: {
  bets: RevealBet[];
  payoutBreakdown?: PayoutBreakdown | null;
  carriedBonusPool?: number;
  creatorNickname?: string;
  sponsorNickname?: string;
  /** The market resolved to VOID, as opposed to resolving to a real outcome nobody backed. */
  voided: boolean;
  /** Every bet came back whole (void, or a no-winner refund) - see RevealSummary. */
  refundish: boolean;
}) {
  const [open, setOpen] = useState(false);
  const settlement = computeSettlement(bets, payoutBreakdown, refundish);
  const { mode, staked, bonusIn, pool, winningPool, dust, dustBet } = settlement;
  const sorted = [...bets].sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0));
  const perWinningToken = winningPool > 0 ? pool / winningPool : null;

  const summary =
    bets.length === 0
      ? 'Nobody bet on this one'
      : mode === 'split'
        ? `Where all ${formatTokens(pool)} tokens went instead`
        : mode === 'refunded'
          ? `How all ${formatTokens(pool)} tokens came back`
          : `Where all ${formatTokens(pool)} tokens went, bet by bet`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-[20px] border border-espresso-100 bg-paper-white px-4 py-3.5 text-left transition-colors hover:bg-espresso-50"
      >
        <span className="min-w-0">
          <span className="block text-[14.5px] font-bold text-espresso-800">Full ledger</span>
          <span className="block truncate text-[12.5px] text-espresso-400">{summary}</span>
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-espresso-300" />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} padded={false} panelClassName="overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[13px]">
            <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">Full ledger</p>
            <p className="shrink-0 text-xs font-semibold text-espresso-500">
              {bets.length} bet{bets.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col gap-4 p-[18px]">
              {/* A market can reach here with no bets at all: expire_stale() auto-voids one that
                  hits closes_at with nothing staked. The arithmetic sections below would all be
                  zeroes explaining a pool that never existed. */}
              {bets.length === 0 && (
                <div className="flex flex-col gap-2">
                  <SectionLabel>How it settled</SectionLabel>
                  <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                    Nobody put a token down before this market {voided ? 'was voided' : 'resolved'}, so there was no
                    pool and nothing to settle.
                  </p>
                  {!!carriedBonusPool && carriedBonusPool > 0 && (
                    <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                      The {formatTokens(carriedBonusPool)} bonus tokens this market carried moved on to the group's
                      other open markets, or are being held for the next one if there were none. Bonus money only
                      ever moves forward.
                    </p>
                  )}
                </div>
              )}

              {bets.length > 0 && (
              <div className="flex flex-col gap-2">
                <SectionLabel>The pool</SectionLabel>
                <Row label={`Staked by ${bets.length} bet${bets.length === 1 ? '' : 's'}`} value={formatTokens(staked)} />
                {bonusIn > 0 && <Row label="Bonus carried in" value={`+${formatTokens(bonusIn)}`} tone="bonus" />}
                <Row
                  label={mode === 'refunded' ? 'Came back' : mode === 'split' ? 'Shared out' : 'Paid out'}
                  value={formatTokens(pool)}
                  tone="total"
                  divided
                />
                {bonusIn > 0 && (
                  <p className="text-[12.5px] leading-[1.45] text-espresso-400">
                    The bonus is money an earlier market ended up with no winners for. It rides into this pool
                    untaxed and pays out with the rest of it.
                  </p>
                )}
              </div>
              )}

              {bets.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-espresso-50 pt-3.5">
                <SectionLabel>How it settled</SectionLabel>

                {mode === 'paid' && (
                  <>
                    <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                      {formatTokens(winningPool)} of the {formatTokens(staked)} staked was on the outcome that
                      happened, so the whole pool was split across those bets in proportion to their stake.
                      {perWinningToken !== null && ` Every winning token returned ${perWinningToken.toFixed(2)}.`}
                    </p>
                    <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                      Each payout is rounded down to a whole token.{' '}
                      {dust > 0 ? (
                        <>
                          That left {formatTokens(dust)} token{dust === 1 ? '' : 's'} over, and the whole remainder
                          goes to the single biggest winning stake
                          {dustBet ? (
                            <>
                              , here <Mention nickname={dustBet.nickname} />
                            </>
                          ) : null}
                          . That is what makes the payouts add up to the pool exactly, with nothing created and
                          nothing lost.
                        </>
                      ) : (
                        <>Nothing was left over this time, so the payouts add up to the pool exactly.</>
                      )}
                    </p>
                  </>
                )}

                {mode === 'refunded' && (
                  <>
                    <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                      {voided
                        ? 'A voided market pays nobody. Every stake was refunded in full, so there was nothing to divide, nothing to round, and no remainder.'
                        : 'Nobody backed the outcome that happened, so there was no winning side to pay. Every stake was refunded in full instead, with nothing to divide and no remainder.'}
                    </p>
                    {!!carriedBonusPool && carriedBonusPool > 0 && (
                      <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                        The {formatTokens(carriedBonusPool)} bonus tokens this market carried were not refunded to
                        anyone. Bonus money only ever moves forward, so it went on to the group's other open
                        markets, or is being held for the next one if there were none.
                      </p>
                    )}
                  </>
                )}

                {mode === 'split' && payoutBreakdown && (
                  <>
                    <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                      Nobody backed the outcome that happened, and this group shares that pool out rather than
                      refunding it. No stake came back.
                    </p>
                    <div className="mt-1 flex flex-col gap-2">
                      {payoutBreakdown.creator_cut > 0 && (
                        <Row
                          label={<>Creator {creatorNickname && <Mention nickname={creatorNickname} />}</>}
                          value={formatTokens(payoutBreakdown.creator_cut)}
                        />
                      )}
                      {/* The endorser's cut was removed (20260810130000), so this is always 0 on
                          anything resolved since. Markets that resolved before it still carry a
                          real number and deserve to render honestly. */}
                      {payoutBreakdown.endorser_cut > 0 && (
                        <Row
                          label={<>Endorser {sponsorNickname && <Mention nickname={sponsorNickname} />}</>}
                          value={formatTokens(payoutBreakdown.endorser_cut)}
                        />
                      )}
                      {payoutBreakdown.other_markets_cut > 0 && (
                        <Row label="Into the group's other open markets" value={formatTokens(payoutBreakdown.other_markets_cut)} />
                      )}
                      {payoutBreakdown.held_in_group_pool > 0 && (
                        <Row label="Held for the group's next market" value={formatTokens(payoutBreakdown.held_in_group_pool)} />
                      )}
                    </div>
                    <p className="text-[13.5px] leading-[1.5] text-espresso-700">
                      The creator's share is rounded down to a whole token, and everything left over goes on to
                      the group's other open markets, split evenly between them with the rounding remainder
                      landing on the oldest. If there were no open markets to receive it, the whole remainder is
                      held for the group's next one.
                    </p>
                  </>
                )}
              </div>
              )}

              {bets.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-espresso-50 pt-3.5">
                <SectionLabel>Every bet</SectionLabel>
                {sorted.length > 0 && (
                  <ul className="overflow-hidden rounded-[16px] border border-espresso-100">
                    {sorted.map((b, i) => {
                      const won = !refundish && b.isWinner;
                      const lost = !refundish && !b.isWinner;
                      const winnings = won ? (b.payout ?? 0) - b.amount : 0;

                      return (
                        <li
                          key={i}
                          className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 ${i > 0 ? 'border-t border-espresso-100' : ''}`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${won ? 'bg-success-500' : 'bg-espresso-200'}`} />
                            <div className="min-w-0">
                              <Mention nickname={b.nickname} className="text-[14px] font-bold text-espresso-800" />
                              <p className="truncate text-[12px] text-espresso-400">
                                Bet {formatTokens(b.amount)} on <OptionLabel label={b.choiceLabel.toUpperCase()} />
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-[14px] font-extrabold">
                            {refundish && (
                              <span className="text-espresso-500">
                                {b.payout === b.amount
                                  ? `↩ refunded ${formatTokens(b.payout)}`
                                  : b.payout && b.payout > 0
                                    ? `↩ ${formatTokens(b.payout)} back`
                                    : '0 back'}
                              </span>
                            )}
                            {/* A win that pays out exactly the stake means nobody took the other side, so
                                there were no losing stakes to split. "+0 won" read as a bug and "you won
                                your bet back" read like a consolation prize, when in fact the call was
                                right and the money simply comes back untouched. */}
                            {won && winnings === 0 && (
                              <>
                                <p className="text-success-700">Won</p>
                                <p className="text-[11px] font-semibold text-espresso-400">{formatTokens(b.payout ?? 0)} returned</p>
                              </>
                            )}
                            {won && winnings > 0 && (
                              <>
                                <p className="text-success-700">+{formatTokens(winnings)} won</p>
                                <p className="text-[11px] font-semibold text-espresso-400">
                                  {formatTokens(b.payout ?? 0)} back total
                                  {dust > 0 && dustBet === b ? `, incl. ${formatTokens(dust)} rounding` : ''}
                                </p>
                              </>
                            )}
                            {lost && <span className="font-bold text-espresso-300">−{formatTokens(b.amount)} lost</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              )}
            </div>
          </div>

          <div className="border-t border-espresso-50 px-[18px] py-[14px]">
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
