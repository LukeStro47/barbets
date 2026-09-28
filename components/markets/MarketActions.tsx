'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { castVote, finalizeMarket } from '@/lib/actions/resolution';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { StickyFooter, FooterButton, StatCell } from '@/components/ui/Screen';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { sideTitle } from '@/components/markets/MarketScreen';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import type { Market, MarketOption } from '@/lib/actions/markets';

/** True once `target` has passed — gates the manual "finalize now" fallback. */
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

interface Props {
  groupId: string;
  market: Market;
  proposal: Proposal | null;
  challenge: Challenge | null;
  myVote: { outcome: string | null; voted_option_id: string | null } | null;
  currentUserId: string;
  proposerNickname?: string;
  challengerNickname?: string;
  options: MarketOption[] | null;
  resolutionWindowHours: number;
  votesCast?: number;
  eligibleVoters?: number;
  myStake: number;
  /** over_under only: the line's number, so a side reads "Over 4.5". */
  lineNumber?: string;
}

/**
 * 5k: the sealed ballot a challenge opens. An ink card states what's in dispute (who challenged,
 * the question, who called it and what they said), then "What actually happened" as radio rows
 * with "Nobody can say" (void) last, the sealed note, the clock / turnout / your stake, the rule,
 * and "Lock in my vote" in the footer. Selecting is staged; the footer commits. A vote can be
 * changed until the window shuts, so the footer re-arms whenever the selection differs from the
 * ballot on file. Only a count of ballots is ever shown, never who or which way.
 *
 * Voiding is not here — it lives in MarketOverflowMenu, so a danger action never competes with
 * the one thing this screen asks you to do.
 */
export function MarketActions({
  groupId,
  market,
  proposal,
  challenge,
  myVote,
  proposerNickname,
  challengerNickname,
  options,
  resolutionWindowHours,
  votesCast,
  eligibleVoters,
  myStake,
  lineNumber,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const onFile = myVote?.voted_option_id ?? myVote?.outcome ?? null;
  const [choice, setChoice] = useState<string | null>(onFile);
  // Once a ballot is on file the page shows the market with a "your vote is in" card rather than
  // the open ballot; "Change my vote" brings the ballot back until the window shuts.
  const [editing, setEditing] = useState(!onFile);

  const windowEnd = challenge ? new Date(new Date(challenge.created_at).getTime() + resolutionWindowHours * 3_600_000).toISOString() : null;
  const voteWindowElapsed = useElapsed(windowEnd);

  if (market.status !== 'disputed' || !challenge) return null;

  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);
  const sideLabel = (s: string) => `${sideTitle(s)}${lineNumber ? ` ${lineNumber}` : ''}`;
  const choices: { value: string; label: string; sub?: string }[] = [
    ...(isMultipleChoice ? (options ?? []).map((o) => ({ value: o.id, label: o.label })) : sides.map((s) => ({ value: s, label: sideLabel(s) }))),
    { value: 'void', label: 'Nobody can say', sub: 'Voids the market, every stake back' },
  ];
  const calledLabel = proposal
    ? proposal.proposed_option_id
      ? ((options ?? []).find((o) => o.id === proposal.proposed_option_id)?.label ?? '')
      : proposal.proposed_outcome === 'void'
        ? 'Nobody can say'
        : proposal.proposed_outcome
          ? sideLabel(proposal.proposed_outcome)
          : ''
    : '';

  function lockIn() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const result = await castVote(
        groupId,
        market.id,
        isMultipleChoice && choice !== 'void' ? { optionId: choice } : { outcome: choice as 'yes' | 'no' | 'over' | 'under' | 'void' }
      );
      if (result.error) setError(result.error);
      else {
        setEditing(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        router.refresh();
      }
    });
  }

  const votedLabel = choice ? (choices.find((c) => c.value === choice)?.label ?? '') : '';
  const unchanged = choice !== null && choice === onFile;

  return (
    <>
      <div className="rounded-[22px] bg-ink p-5">
        <p className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">
          {challengerNickname ? `${challengerNickname} challenged the call` : 'The call was challenged'}
        </p>
        <p className="mt-3 text-[20px] leading-[1.25] font-extrabold tracking-[-0.02em] text-surface text-pretty">{market.title}</p>
        <div className="mt-4 flex items-center gap-3 border-t border-white/12 pt-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold tracking-[0.1em] text-faint uppercase">
              {proposerNickname ? `${proposerNickname} called it` : 'Called'}
            </span>
            <span className="mt-1 block truncate text-[16px] font-extrabold text-surface">
              <OptionLabel label={calledLabel} />
            </span>
          </span>
          <span className="shrink-0 rounded-lg bg-white/12 px-2.5 py-[5px] text-[11.5px] font-bold text-[#a8b0bd]">In dispute</span>
        </div>
        {proposal?.justification && <p className="mt-3 text-[12.5px] leading-[1.45] text-[#a8b0bd]">&ldquo;{proposal.justification}&rdquo;</p>}
        {proposal?.photo_path && (
          <div className="mt-3">
            <ResolutionProofButton marketId={market.id} variant="action" />
          </div>
        )}
      </div>

      {!editing && choice && (
        <div className="mt-[11px] flex items-center gap-3 rounded-[20px] border-[1.5px] border-signal bg-signal-wash px-4 py-3.5">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-signal text-surface">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M2 6.3 4.6 9 10 3.2" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold tracking-[0.1em] text-signal uppercase">Your vote is in</span>
            <span className="mt-0.5 block truncate text-[16px] font-extrabold text-ink">
              <OptionLabel label={votedLabel} />
            </span>
            <span className="mt-0.5 block text-[12px] leading-[1.4] text-signal-ink">Sealed until the window shuts. You can change it until then.</span>
          </span>
        </div>
      )}

      {editing && (
      <>
      <p className="mt-[22px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">What actually happened</p>
      <div className="mt-[9px] flex flex-col gap-2">
        {choices.map((c) => {
          const on = choice === c.value;
          return (
            <button
              key={c.value}
              type="button"
              disabled={isPending}
              onClick={() => setChoice(c.value)}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl px-4 py-[15px] text-left',
                on ? 'border-[1.5px] border-signal bg-signal-wash' : 'border border-hairline bg-surface'
              )}
            >
              <span className={cn('h-[18px] w-[18px] shrink-0 rounded-full bg-surface', on ? 'border-[5px] border-signal' : 'border-[1.5px] border-dash')} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[15.5px]', on ? 'font-extrabold text-ink' : 'font-bold text-muted')}>
                  <OptionLabel label={c.label} />
                </span>
                {c.sub && <span className="mt-0.5 block text-[11.5px] text-faint">{c.sub}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-[11px] rounded-2xl border border-hairline bg-surface px-[15px] py-3.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-tile text-muted">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-muted text-pretty">
          Sealed. Nobody sees a single vote, yours included, until the window shuts.
        </span>
      </div>
      </>
      )}

      <div className="mt-3 flex rounded-2xl border border-hairline bg-surface px-4 py-[15px]">
        <StatCell first label="Final in" value={windowEnd ? <CountdownTimer target={windowEnd} prefix="" /> : '—'} tone="signal" />
        <StatCell
          label="Voted"
          value={votesCast !== undefined && eligibleVoters !== undefined ? `${votesCast} of ${eligibleVoters}` : '—'}
        />
        <StatCell label="Your stake" value={formatTokens(myStake)} flex={1.1} />
      </div>

      {/* The real rule (cast_vote/finalize_market), not the mock's simpler "a tie voids": no votes,
          or a tie that includes the call, keeps the call; any other tie voids. */}
      <p className="mt-3.5 text-[12px] leading-[1.5] text-faint text-pretty">
        Most votes wins. No votes, or a tie that includes the call, keeps the call. Any other tie voids the market and every stake goes back.
      </p>

      {voteWindowElapsed && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await finalizeMarket(groupId, market.id);
              if (result.error) setError(result.error);
              else router.refresh();
            })
          }
          className="mt-3 w-full text-center text-[12px] text-faint underline"
        >
          Finalize now
        </button>
      )}

      <StickyFooter>
        {error && <p className="text-[12px] font-semibold text-alert">{error}</p>}
        {editing ? (
          <>
            <FooterButton disabled={!choice || unchanged || isPending} onClick={lockIn}>
              {isPending ? 'Locking in' : unchanged ? 'Vote locked in' : onFile ? 'Change my vote' : 'Lock in my vote'}
            </FooterButton>
            {onFile && (
              <button
                type="button"
                onClick={() => {
                  setChoice(onFile);
                  setEditing(false);
                }}
                className="text-center text-[13px] font-semibold text-faint"
              >
                Keep my vote
              </button>
            )}
          </>
        ) : (
          <FooterButton tone="outline" onClick={() => setEditing(true)}>
            Change my vote
          </FooterButton>
        )}
      </StickyFooter>
    </>
  );
}
