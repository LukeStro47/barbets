'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sponsorMarket } from '@/lib/actions/markets';
import { placeBet } from '@/lib/actions/bets';
import { proposeResolution, challengeResolution, castVote, finalizeMarket } from '@/lib/actions/resolution';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { OptionLabel } from '@/components/markets/OptionLabel';
import type { Market, MarketOption } from '@/lib/actions/markets';
import type { ActionResult } from '@/lib/errors';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

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
}

interface Challenge {
  challenger_id: string;
  created_at: string;
}

interface Props {
  groupId: string;
  market: Market;
  isCreator: boolean;
  isSponsor: boolean;
  balance: number;
  proposal: Proposal | null;
  challenge: Challenge | null;
  myVote: { outcome: string | null; voted_option_id: string | null } | null;
  currentUserId: string;
  /** Populated only for multiple_choice markets, in sort_order. */
  options: MarketOption[] | null;
}

export function MarketActions({
  groupId,
  market,
  isCreator,
  balance,
  proposal,
  challenge,
  myVote,
  currentUserId,
  options,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const [betSide, setBetSide] = useState<'yes' | 'no' | 'over' | 'under'>(market.market_type === 'yes_no' ? 'yes' : 'over');
  const [betOptionId, setBetOptionId] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState(Math.min(balance, 10));
  const [justification, setJustification] = useState('');
  const [proposeOutcome, setProposeOutcome] = useState<string | null>(null);
  const [voteChoice, setVoteChoice] = useState<string | null>(myVote?.voted_option_id ?? myVote?.outcome ?? null);
  const [showEarlyPropose, setShowEarlyPropose] = useState(false);

  const challengeWindowElapsed = useElapsed(proposal ? new Date(new Date(proposal.proposed_at).getTime() + 24 * 3_600_000).toISOString() : null);
  const voteWindowElapsed = useElapsed(challenge ? new Date(new Date(challenge.created_at).getTime() + 24 * 3_600_000).toISOString() : null);

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

  function proposalChoiceFor(value: string) {
    return isMultipleChoice && value !== 'void'
      ? ({ optionId: value } as const)
      : ({ outcome: value as 'yes' | 'no' | 'over' | 'under' | 'void' } as const);
  }

  function renderProposeCard(warning?: string) {
    return (
      <Card className="space-y-3">
        <p className="text-sm font-semibold text-espresso-700">Propose what happened</p>
        {warning && <p className="text-xs font-semibold text-danger-700">{warning}</p>}
        <div className="flex flex-wrap gap-2">
          {choiceLabels.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setProposeOutcome(c.value)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold uppercase ${
                proposeOutcome === c.value ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
              }`}
            >
              <OptionLabel label={c.label} />
            </button>
          ))}
        </div>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Short justification (optional, but helps everyone trust the call)"
          rows={2}
          className={inputClasses}
        />
        <Button
          disabled={isPending || !proposeOutcome}
          onClick={() => proposeOutcome && run(() => proposeResolution(groupId, market.id, proposalChoiceFor(proposeOutcome), justification || undefined))}
          className="w-full"
        >
          Submit proposal
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {market.status === 'pending_sponsor' && !isCreator && (
        <Card>
          <p className="mb-3 text-sm text-espresso-600">
            Two humans behind every market. Endorse this one to open it up for betting.
          </p>
          <Button disabled={isPending} onClick={() => run(() => sponsorMarket(market.id))} className="w-full">
            Endorse this market
          </Button>
        </Card>
      )}

      {market.status === 'open' && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-espresso-700">Place your bet</p>
          {isMultipleChoice ? (
            <div className="flex flex-col gap-2">
              {(options ?? []).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setBetOptionId(o.id)}
                  className={`rounded-xl border px-4 py-2 text-left text-sm font-bold ${
                    betOptionId === o.id ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
                  }`}
                >
                  <OptionLabel label={o.label} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBetSide(sides[0])}
                className={`flex-1 rounded-full border py-2 text-sm font-bold uppercase ${
                  betSide === sides[0] ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
                }`}
              >
                {sides[0]}
              </button>
              {market.market_type === 'over_under' && (
                <span className="shrink-0 rounded-full bg-espresso-100 px-3 py-1 text-xs font-bold text-espresso-600">
                  {market.line}
                </span>
              )}
              <button
                type="button"
                onClick={() => setBetSide(sides[1])}
                className={`flex-1 rounded-full border py-2 text-sm font-bold uppercase ${
                  betSide === sides[1] ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
                }`}
              >
                {sides[1]}
              </button>
            </div>
          )}

          <div className="space-y-1.5 border-t border-espresso-100 pt-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-400">Your bet</label>
            <div className="relative">
              <input
                type="number"
                min={1}
                max={balance}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                className={`${inputClasses} pr-20`}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-espresso-400">
                tokens
              </span>
            </div>
            <p className="text-xs text-espresso-400">Your balance: {balance} tokens</p>
          </div>

          <Button
            disabled={isPending || betAmount < 1 || betAmount > balance || (isMultipleChoice && !betOptionId)}
            onClick={() =>
              run(() => placeBet(groupId, market.id, betAmount, isMultipleChoice ? { optionId: betOptionId! } : { side: betSide }))
            }
            className="w-full"
            variant="accent"
          >
            Place bet
          </Button>
        </Card>
      )}

      {market.status === 'open' &&
        (!showEarlyPropose ? (
          <button
            type="button"
            onClick={() => setShowEarlyPropose(true)}
            className="w-full text-center text-xs text-espresso-400 underline"
          >
            Already decided? Propose the outcome
          </button>
        ) : (
          renderProposeCard('Proposing now locks betting for everyone immediately.')
        ))}

      {market.status === 'closed' && renderProposeCard()}

      {market.status === 'proposed' && proposal && (
        <Card className="space-y-3">
          <p className="text-sm text-espresso-600">
            <CountdownTimer target={new Date(new Date(proposal.proposed_at).getTime() + 24 * 3_600_000).toISOString()} prefix="Challenge window closes in" />
          </p>
          {iAmProposer ? (
            <p className="text-xs text-espresso-400">You proposed this outcome, so you can't challenge it yourself.</p>
          ) : (
            <Button variant="outline" disabled={isPending} onClick={() => run(() => challengeResolution(groupId, market.id))} className="w-full">
              Challenge this proposal
            </Button>
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
        <Card className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-espresso-700">Cast your vote</p>
            <p className="text-xs text-espresso-500">
              Secret ballot on what actually happened, not on whether you agree with the proposal. Vote VOID if it
              can't be fairly judged. A tie or no votes upholds the proposal; a tie without it voids instead.
              Ballots reveal once voting closes, early if everyone's voted. You can change your vote until then.
            </p>
            <p className="text-sm text-espresso-600">
              <CountdownTimer target={new Date(new Date(challenge.created_at).getTime() + 24 * 3_600_000).toISOString()} prefix="Voting closes in" />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {choiceLabels.map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={isPending}
                onClick={() => {
                  setVoteChoice(c.value);
                  run(() => castVote(groupId, market.id, proposalChoiceFor(c.value)));
                }}
                className={`flex-1 rounded-full border py-2 text-sm font-bold uppercase ${
                  voteChoice === c.value ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
                }`}
              >
                <OptionLabel label={c.label} />
              </button>
            ))}
          </div>
          {voteChoice && (
            <p className="text-center text-xs text-espresso-400">
              Your current vote: {(choiceLabels.find((c) => c.value === voteChoice)?.label ?? voteChoice).toUpperCase()}
            </p>
          )}
          {voteWindowElapsed && (
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
    </div>
  );
}
