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
      {error && <p className="text-[13.5px] text-alert">{error}</p>}

      {market.status === 'proposed' && proposal && (
        <Card className="space-y-3">
          <p className="text-[13.5px] text-muted">
            <CountdownTimer target={new Date(new Date(proposal.proposed_at).getTime() + resolutionWindowMs).toISOString()} prefix="Challenge window closes in" />
          </p>
          {iAmProposer ? (
            <p className="text-[12.5px] text-faint">You proposed this outcome, so you can&apos;t challenge it yourself.</p>
          ) : !confirmingChallenge ? (
            <Button variant="outline" disabled={isPending} onClick={() => setConfirmingChallenge(true)} className="w-full border-alert text-alert hover:bg-alert-bg">
              Challenge this proposal
            </Button>
          ) : (
            <div className="overflow-hidden rounded-[18px] border border-alert-line bg-alert-bg">
              <p className="px-3.5 pt-3 text-[12.5px] leading-[1.45] font-semibold text-alert">
                This moves the market to a secret ballot for everyone eligible to vote on what actually happened.
              </p>
              <div className="flex gap-2 p-3">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmingChallenge(false)}>
                  Cancel
                </Button>
                <Button
                  variant="dark"
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => run(() => challengeResolution(groupId, market.id))}
                >
                  Confirm
                </Button>
              </div>
            </div>
          )}
          {challengeWindowElapsed && (
            <button
              disabled={isPending}
              onClick={() => run(() => finalizeMarket(groupId, market.id))}
              className="w-full text-center text-[12.5px] font-semibold text-faint underline"
            >
              Finalize now
            </button>
          )}
        </Card>
      )}

      {market.status === 'disputed' && challenge && (
        <div className="overflow-hidden rounded-[24px] border border-alert-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-alert-line bg-alert-bg px-4 py-3">
            <p className="text-[11.5px] font-bold tracking-[0.1em] text-alert uppercase">Your ballot</p>
            {votesCast !== undefined && eligibleVoters !== undefined && (
              <p className="font-mono text-[12.5px] font-semibold text-alert">
                {votesCast} of {eligibleVoters} voted
              </p>
            )}
          </div>

          <div className="space-y-3.5 p-4">
            {proposal && (
              <div className="space-y-1 rounded-[14px] border border-hairline bg-canvas px-3.5 py-3">
                <p className="text-[12.5px] text-muted">
                  {proposerNickname ? <Mention nickname={proposerNickname} /> : 'Someone'} proposed{' '}
                  <strong className="font-bold text-ink">
                    <OptionLabel label={(proposalChoiceLabel ?? '').toUpperCase()} />
                  </strong>
                </p>
                {proposal.justification && <p className="text-[13.5px] leading-[1.45] text-muted">&ldquo;{proposal.justification}&rdquo;</p>}
                {proposal.photo_path && <ResolutionProofButton marketId={market.id} variant="action" />}
              </div>
            )}

            <div className="space-y-0.5">
              <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">What actually happened?</p>
              <p className="text-[13.5px] leading-[1.5] text-muted">
                Vote on the outcome, not on whether you agree with the proposal.{' '}
                <button type="button" onClick={() => setShowRulesModal(true)} className="font-bold text-signal">
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
                      className={`flex w-full items-center gap-2.5 rounded-[14px] border px-3.5 py-3 text-left text-[15px] font-bold uppercase ${
                        selected ? 'border-ink bg-ink text-white' : 'border-hairline bg-surface text-muted'
                      }`}
                    >
                      <span
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                          selected ? 'border-on-ink' : 'border-hairline'
                        }`}
                      >
                        {selected && <span className="h-2 w-2 rounded-full bg-on-ink" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <OptionLabel label={c.label} />
                      </span>
                      {c.value === 'void' && (
                        <span className={`shrink-0 text-[12px] font-semibold normal-case ${selected ? 'text-white/55' : 'text-faint'}`}>
                          Can&apos;t be judged
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex w-full items-center gap-2.5 rounded-[14px] border border-ink bg-ink px-3.5 py-3">
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-on-ink">
                  <span className="h-2 w-2 rounded-full bg-on-ink" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-white">
                  Your vote:{' '}
                  <OptionLabel label={(choiceLabels.find((c) => c.value === voteChoice)?.label ?? '').toUpperCase()} />
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setBallotExpanded(true)}
                  className="shrink-0 text-[12.5px] font-bold text-on-ink underline"
                >
                  Switch vote
                </button>
              </div>
            )}

            <p className="text-[12.5px] text-faint">Secret until voting closes. Change it any time before then.</p>

            {voteWindowElapsed && (
              <button
                disabled={isPending}
                onClick={() => run(() => finalizeMarket(groupId, market.id))}
                className="w-full text-center text-[12.5px] font-semibold text-faint underline"
              >
                Finalize now
              </button>
            )}
          </div>
        </div>
      )}

      {showRulesModal && (
        <Modal onClose={() => setShowRulesModal(false)}>
          <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">How votes settle</p>
          <p className="text-[13.5px] leading-[1.5] text-muted">
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
