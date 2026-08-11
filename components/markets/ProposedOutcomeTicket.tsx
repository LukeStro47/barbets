import { TicketCard } from '@/components/markets/TicketCard';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { NeutralOddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { Mention } from '@/components/ui/Mention';
import { PositionRows, type PositionTicketRow } from '@/components/markets/PositionPayouts';

interface SideOdds {
  side: string;
  pool_percent: number;
}
interface OptionOdds {
  option_id: string;
  label: string;
  pool_percent: number;
}

/**
 * The hero of the proposed-outcome screen: the call itself, who made it, what they offered as
 * proof, and where the money had settled when betting locked.
 *
 * The call gets the ticket outline and the 34px number because reading it is the entire job of
 * this screen — challenging is the exception, not the expectation, so that action lives further
 * down under a divider rather than competing here. The pool split appears now (and not one stage
 * earlier) because betting has locked: there is no longer a bet for it to influence.
 *
 * The viewer's own position rides inside this card rather than in one below it. What a call is
 * worth to you personally is not a separate fact from the call — it is the first thing anyone
 * reads it for, and splitting the two across cards made you look in two places to answer one
 * question.
 */
export function ProposedOutcomeTicket({
  marketId,
  outcomeLabel,
  proposerNickname,
  justification,
  hasPhoto,
  positionRows = [],
  sideOdds,
  optionOdds,
  lineLabel,
}: {
  marketId: string;
  outcomeLabel: string;
  proposerNickname?: string;
  justification?: string | null;
  hasPhoto: boolean;
  /** The viewer's own stake(s), each flagged with whether this proposal standing would win it. */
  positionRows?: PositionTicketRow[];
  sideOdds?: SideOdds[];
  optionOdds?: OptionOdds[];
  /** over_under only — the line, wedged between the two sides of the split bar. */
  lineLabel?: string;
}) {
  const hasSplit = (sideOdds && sideOdds.length === 2) || (optionOdds && optionOdds.length > 0);

  return (
    <TicketCard
      label="Proposed outcome"
      meta={proposerNickname ? <>by <Mention nickname={proposerNickname} /></> : undefined}
      bodyClassName="px-[18px] pt-4 pb-[18px]"
    >
      <div className="space-y-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate font-display text-[34px] leading-none font-extrabold tracking-[-0.02em] text-espresso-950">
            <OptionLabel label={outcomeLabel} />
          </p>
          {hasPhoto && <ResolutionProofButton marketId={marketId} variant="chip" />}
        </div>

        {justification && <p className="text-[14.5px] leading-[1.45] text-espresso-700 text-pretty">&ldquo;{justification}&rdquo;</p>}

        {positionRows.length > 0 && (
          <div className="border-t border-espresso-50 pt-3.5">
            <PositionRows rows={positionRows} leftLabel="Your position" />
          </div>
        )}

        {hasSplit && (
          <div className="border-t border-espresso-50 pt-3.5">
            <p className="mb-2 text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Where the money sat</p>
            {sideOdds && sideOdds.length === 2 ? (
              <NeutralOddsBar
                left={{ label: sideOdds[0].side.toUpperCase(), percent: sideOdds[0].pool_percent }}
                right={{ label: sideOdds[1].side.toUpperCase(), percent: sideOdds[1].pool_percent }}
                center={lineLabel}
                size="lg"
              />
            ) : (
              <OddsBarMulti options={(optionOdds ?? []).map((o) => ({ id: o.option_id, label: o.label, percent: o.pool_percent }))} />
            )}
          </div>
        )}
      </div>
    </TicketCard>
  );
}
