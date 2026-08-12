'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { challengeResolution, castVote, finalizeMarket } from '@/lib/actions/resolution';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { Mention } from '@/components/ui/Mention';
import type { Market, MarketOption } from '@/lib/actions/markets';
import type { ActionResult } from '@/lib/errors';

/** True once `target` has passed — used to gate the manual "check now" fallback until the real timer would actually let it succeed. */
function useElapsed(target: string | null): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!target) return;
    const check = () => setElapsed(new Date(target).getTime() <= Date.now());
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [target]);
  return elapsed;
}

interface Proposal {
  proposer_id: string;
  proposed_outcome: string | null;
  proposed_option_id: string | null;
  justification: string | null;
  proposed_at: string;
  photo_path?: string | null;
}

interface Challenge {
  challenger_id: string;
  created_at: string;
}

/**
 * The stage's own action on an in-flight market: challenge a proposal, cast a ballot, finalize once
 * a window has run out. **Voiding is deliberately not here** — it lives in `MarketOverflowMenu`'s
 * "···" at the top of the page, because a permanently-visible danger card competed with the one
 * thing the screen is actually asking you to do. This component therefore takes no owner/creator
 * identity at all. (It used to carry `isOwner`/`isCreator`/`ownerIsSubject`/`isSponsor` and a
 * `hideVoidCard` escape hatch for two void cards; the page passed `hideVoidCard` unconditionally
 * from the day the overflow menu landed, so all of it was unreachable and has been removed.)
 */
interface Props {
  groupId: string;
  market: Market;
  proposal: Proposal | null;
  challenge: Challenge | null;
  myVote: { outcome: string | null; voted_option_id: string | null } | null;
  currentUserId: string;
  /** disputed only: display name for the proposal-quote block ("@sam proposed NO"). */
  proposerNickname?: string;
  /** Populated only for multiple_choice markets, in sort_order. */
  options: MarketOption[] | null;
  /** group_settings.resolution_window_hours — shared by the challenge window (propose -> dispute) and the vote window (dispute -> finalize). */
  resolutionWindowHours: number;
  /** disputed only: ballots cast so far vs. eligible voters, for the "N of M voted" count. */
  votesCast?: number;
  eligibleVoters?: number;
}

export function MarketActions({
  groupId,
  market,
  proposal,
  challenge,
  myVote,
  currentUserId,
  proposerNickname,
  options,
  resolutionWindowHours,
  votesCast,
  eligibleVoters,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const [voteChoice, setVoteChoice] = useState<string | null>(myVote?.voted_option_id ?? myVote?.outcome ?? null);
  // Collapsed the moment there's a vote to show, whether that's one already on file (loading
  // the page after having voted) or one just cast this session — expands back out only via
  // "Switch vote," instead of always showing all three options once a ballot's already in.
  const [ballotExpanded, setBallotExpanded] = useState(voteChoice === null);
  const [confirmingChallenge, setConfirmingChallenge] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);

  const resolutionWindowMs = resolutionWindowHours * 3_600_000;
  const challengeWindowElapsed = useElapsed(proposal ? new Date(new Date(proposal.proposed_at).getTime() + resolutionWindowMs).toISOString() : null);
  const voteWindowElapsed = useElapsed(challenge ? new Date(new Date(challenge.created_at).getTime() + resolutionWindowMs).toISOString() : null);

  function run(fn: () => Promise<ActionResult<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);
  /** Choices offered on a ballot/proposal: every option (or side) plus VOID. */
  const choiceLabels: { value: string; label: string }[] = isMultipleChoice
    ? [...(options ?? []).map((o) => ({ value: o.id, label: o.label })), { value: 'void', label: 'VOID' }]
    : [...sides.map((s) => ({ value: s, label: s.toUpperCase() })), { value: 'void', label: 'VOID' }];
  const iAmProposer = proposal?.proposer_id === currentUserId;
  const proposalChoiceLabel = proposal
    ? proposal.proposed_option_id
      ? ((options ?? []).find((o) => o.id === proposal.proposed_option_id)?.label ?? null)
      : proposal.proposed_outcome
    : null;

  function proposalChoiceFor(value: string) {
    return isMultipleChoice && value !== 'void'
      ? ({ optionId: value } as const)
      : ({ outcome: value as 'yes' | 'no' | 'over' | 'under' | 'void' } as const);
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {market.status === 'proposed' && proposal && (
        <Card className="space-y-3">
          <p className="text-sm text-espresso-600">
            <CountdownTimer target={new Date(new Date(proposal.proposed_at).getTime() + resolutionWindowMs).toISOString()} prefix="Challenge window closes in" />
          </p>
          {iAmProposer ? (
            <p className="text-xs text-espresso-400">You proposed this outcome, so you can't challenge it yourself.</p>
          ) : !confirmingChallenge ? (
            <Button variant="outline" disabled={isPending} onClick={() => setConfirmingChallenge(true)} className="w-full">
              Challenge this proposal
            </Button>
          ) : (
            <>
              <p className="text-xs font-semibold text-danger-700">
                This moves the market to a secret ballot for everyone eligible to vote on what actually happened.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmingChallenge(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => run(() => challengeResolution(groupId, market.id))}
                >
                  Confirm
                </Button>
              </div>
            </>
          )}
          {challengeWindowElapsed && (
            <button
              disabled={isPending}
              onClick={() => run(() => finalizeMarket(groupId, market.id))}
              className="w-full text-center text-xs text-espresso-400 underline"
            >
              Finalize now
            </button>
          )}
        </Card>
      )}

      {market.status === 'disputed' && challenge && (
        <Card className="!rounded-[22px] overflow-hidden !border-[1.5px] !border-danger-500 !p-0 shadow-[0_6px_18px_-10px_rgba(28,19,13,0.35)]">
          <div className="flex items-center justify-between gap-2 bg-danger-100 px-[18px] py-3">
            <p className="text-xs font-extrabold tracking-[0.06em] text-danger-700 uppercase">Your ballot</p>
            {votesCast !== undefined && eligibleVoters !== undefined && (
              <p className="text-[12.5px] font-bold text-danger-700">
                {votesCast} of {eligibleVoters} voted
              </p>
            )}
          </div>

          <div className="space-y-3.5 p-[18px]">
            {proposal && (
              <div className="space-y-1 rounded-2xl bg-espresso-50 p-3.5">
                <p className="text-xs text-espresso-500">
                  {proposerNickname ? <Mention nickname={proposerNickname} /> : 'Someone'} proposed{' '}
                  <strong className="font-extrabold text-espresso-900">
                    <OptionLabel label={(proposalChoiceLabel ?? '').toUpperCase()} />
                  </strong>
                </p>
                {proposal.justification && <p className="text-[13.5px] leading-[1.4] text-espresso-600">"{proposal.justification}"</p>}
                {proposal.photo_path && <ResolutionProofButton marketId={market.id} variant="action" />}
              </div>
            )}

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
                {choiceLabels.map((c) => {
                  const selected = voteChoice === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setVoteChoice(c.value);
                        setBallotExpanded(false);
                        run(() => castVote(groupId, market.id, proposalChoiceFor(c.value)));
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-2xl border-[1.5px] px-3.5 py-3 text-left text-[15px] font-extrabold uppercase ${
                        selected ? 'border-espresso-900 bg-espresso-900 text-paper-white' : 'border-espresso-200 text-espresso-500'
                      }`}
                    >
                      <span
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                          selected ? 'border-honey-300' : 'border-espresso-200'
                        }`}
                      >
                        {selected && <span className="h-2 w-2 rounded-full bg-honey-300" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <OptionLabel label={c.label} />
                      </span>
                      {c.value === 'void' && <span className="shrink-0 text-xs font-semibold text-espresso-400 normal-case">Can't be judged</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex w-full items-center gap-2.5 rounded-2xl border-[1.5px] border-espresso-900 bg-espresso-900 px-3.5 py-3">
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-honey-300">
                  <span className="h-2 w-2 rounded-full bg-honey-300" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-paper-white">
                  Your vote:{' '}
                  <OptionLabel label={(choiceLabels.find((c) => c.value === voteChoice)?.label ?? '').toUpperCase()} />
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setBallotExpanded(true)}
                  className="shrink-0 text-xs font-bold text-honey-300 underline"
                >
                  Switch vote
                </button>
              </div>
            )}

            <p className="text-xs text-espresso-400">Secret until voting closes. Change it any time before then.</p>

            {voteWindowElapsed && (
              <button
                disabled={isPending}
                onClick={() => run(() => finalizeMarket(groupId, market.id))}
                className="w-full text-center text-xs text-espresso-400 underline"
              >
                Finalize now
              </button>
            )}
          </div>
        </Card>
      )}

      {showRulesModal && (
        <Modal onClose={() => setShowRulesModal(false)}>
          <p className="font-display font-bold text-espresso-900">How votes settle</p>
          <p className="text-sm text-espresso-600">
            Secret ballot on what actually happened, not on whether you agree with the proposal. Vote VOID if it
            can't be fairly judged. A tie or no votes upholds the proposal; a tie without it voids instead. Ballots
            reveal once voting closes, early if everyone's voted. You can change your vote until then.
          </p>
          <Button className="w-full" onClick={() => setShowRulesModal(false)}>
            Got it
          </Button>
        </Modal>
      )}

    </div>
  );
}
