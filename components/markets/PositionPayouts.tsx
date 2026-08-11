import { Card } from '@/components/ui/Card';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { TicketCard } from '@/components/markets/TicketCard';
import { formatTokens } from '@/lib/formatNumber';

export interface PositionBet {
  side: string | null;
  option_id: string | null;
  amount: number;
}

interface SideOdds {
  side: string;
  pool_amount: number;
}
interface OptionOdds {
  option_id: string;
  label: string;
  pool_amount: number;
}

export interface Position {
  /** The bet_side value or option_id this position is on — what a proposal/outcome is compared
   * against. Labels are display text (an option's label can be anything, including something
   * that collides with a side name), so matching on them would be matching on the wrong thing. */
  key: string;
  label: string;
  amount: number;
  /** What this position pays out if its side/option is the one that lands. */
  projected: number;
}

/** Groups the viewer's own bets by side/option and projects each one's payout with the exact
 * formula finalize_market() uses (floor(bet.amount * total_pool / winning_pool)), summed per
 * individual bet the way the real payout is rather than flooring the combined total, so this
 * reads as a genuine preview and not a rounded-off guess. A hedge stays split across rows
 * instead of collapsing into one misleading number. */
export function computePositions(myBets: PositionBet[], sideOdds?: SideOdds[], optionOdds?: OptionOdds[]): Position[] {
  const totalPool = sideOdds
    ? sideOdds.reduce((sum, o) => sum + o.pool_amount, 0)
    : (optionOdds ?? []).reduce((sum, o) => sum + o.pool_amount, 0);

  const positions = new Map<string, Position>();
  for (const bet of myBets) {
    const key = bet.side ?? bet.option_id ?? '';
    if (!key) continue;
    const poolAmount = bet.side
      ? (sideOdds?.find((o) => o.side === bet.side)?.pool_amount ?? 0)
      : (optionOdds?.find((o) => o.option_id === bet.option_id)?.pool_amount ?? 0);
    const label = bet.side ? bet.side.toUpperCase() : (optionOdds?.find((o) => o.option_id === bet.option_id)?.label ?? '?');
    const projected = poolAmount > 0 ? Math.floor((bet.amount * totalPool) / poolAmount) : 0;
    const existing = positions.get(key);
    positions.set(key, {
      key,
      label,
      amount: (existing?.amount ?? 0) + bet.amount,
      projected: (existing?.projected ?? 0) + projected,
    });
  }
  return [...positions.values()];
}

/** The sealed-odds counterpart to computePositions: while a market is still `open` there is no
 * pool split to project against (get_closed_odds refuses outright until betting closes), so a
 * position is only ever "what you staked, on what." Same per-side grouping, no payout column. */
export function computeStakedPositions(myBets: PositionBet[], optionLabelById: (id: string) => string): Position[] {
  const positions = new Map<string, Position>();
  for (const bet of myBets) {
    const key = bet.side ?? bet.option_id ?? '';
    if (!key) continue;
    const label = bet.side ? bet.side.toUpperCase() : optionLabelById(bet.option_id!);
    positions.set(key, { key, label, amount: (positions.get(key)?.amount ?? 0) + bet.amount, projected: 0 });
  }
  return [...positions.values()];
}

export interface PositionTicketRow extends Position {
  /** Undefined while odds are sealed — the right-hand column is dropped entirely rather than
   * guessed at. True/false only once an outcome has actually been proposed, which turns the
   * column from "if it lands" into "if this stands." */
  standsToWin?: boolean;
}

/**
 * The template's "Your position" ticket: the first card on any market screen where the viewer
 * has money down, and the reason the explainer card below it disappears — the header band's
 * meta carries the line/option count that card would have shown, so nothing is lost by hiding it.
 */
export function PositionTicket({
  rows,
  meta,
  footer,
  showProjection = true,
}: {
  rows: PositionTicketRow[];
  /** Header band's right side: "Yes / No", "Over / Under · line 12 min", "One of 4 options". */
  meta?: React.ReactNode;
  /** The quiet rule under the body, e.g. "2 of 9 bets on this market". */
  footer?: React.ReactNode;
  showProjection?: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <TicketCard label="Your position" meta={meta} footer={footer} bodyClassName="px-[18px] py-[15px]">
      <div className="space-y-3">
        {rows.map((row, i) => {
          const loses = row.standsToWin === false;
          return (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">Staked</p>
                <p className="mt-0.5 truncate text-base font-extrabold text-espresso-950">
                  {formatTokens(row.amount)} on <OptionLabel label={row.label} />
                </p>
              </div>
              {showProjection && (
                <div className="shrink-0 text-right">
                  <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">
                    {row.standsToWin === undefined ? 'If it lands' : 'If this stands'}
                  </p>
                  <p className={`mt-0.5 text-base font-extrabold ${loses ? 'text-danger-700' : 'text-honey-800'}`}>
                    {loses ? `${formatTokens(row.amount)} lost` : `→ ${formatTokens(row.projected)} back`}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </TicketCard>
  );
}

/** The "Your position → If it lands" rows themselves, with no container of their own, so they can
 * sit inside FinalOddsCard's locked-odds panel or inside the standalone card below. */
export function PositionPayoutRows({ positions }: { positions: Position[] }) {
  return (
    <div className="space-y-2.5">
      {positions.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">Your position</p>
            <p className="mt-0.5 text-base font-extrabold text-espresso-950">
              {formatTokens(p.amount)} on <OptionLabel label={p.label} />
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">If it lands</p>
            <p className="mt-0.5 text-base font-extrabold text-honey-800">&rarr; {formatTokens(p.projected)} back</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Standalone version for the market states where betting is already locked but there's no
 * FinalOddsCard on screen to host it (proposed, disputed) — the odds bar is already being shown
 * elsewhere on those pages, so this carries only the part that's genuinely missing: what the
 * viewer's own stake is actually worth. Renders nothing when they never bet, or when there's no
 * pool data to project against. */
export function YourPositionCard({
  myBets,
  sideOdds,
  optionOdds,
}: {
  myBets: PositionBet[];
  sideOdds?: SideOdds[];
  optionOdds?: OptionOdds[];
}) {
  const positions = computePositions(myBets, sideOdds, optionOdds);
  if (positions.length === 0) return null;

  return (
    <Card className="space-y-2.5">
      <PositionPayoutRows positions={positions} />
      <p className="text-xs text-espresso-400">
        Based on the pool as it locked. The exact number can still change if this market ends up voided or refunded.
      </p>
    </Card>
  );
}
