'use client';

import { TicketCard } from '@/components/markets/TicketCard';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { useBetslip } from '@/components/markets/BetslipContext';
import type { MarketOption } from '@/lib/actions/markets';

/**
 * Slot 2 of the market template: the card that explains what you are choosing between, shown
 * only while the viewer has no position. Once they do, the position ticket's header band carries
 * the same fact ("Over / Under · line 12 min", "One of 4 options") and this comes off the page
 * rather than repeating it. A yes_no market has no explainer at all — the question is the
 * explanation, and a card restating "Yes / No" would be pure furniture.
 */

/**
 * over_under: the line, big, next to the way into the slip.
 *
 * "Pick a side" opens the drawer with *neither* side chosen (the empty `{}` pick, see
 * `BetslipContext`) rather than landing on OVER — this is the one opener that hasn't been told
 * which way you're leaning, and pre-selecting for someone who only said "I want to bet" puts a
 * side under their thumb that they never chose. The two `SideButton`s in the bar still open primed,
 * because tapping one of those *is* saying which side.
 */
export function LineTicket({ lineLabel }: { lineLabel: string }) {
  const betslip = useBetslip();

  return (
    <TicketCard label="The line" meta="Over / Under" bodyClassName="px-[18px] py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-display text-[34px] leading-none font-extrabold tracking-[-0.02em] text-espresso-950 tabular-nums">
          {lineLabel}
        </p>
        <button
          type="button"
          onClick={() => betslip?.open({})}
          disabled={!betslip}
          className="shrink-0 rounded-full border border-espresso-200 bg-transparent px-3 py-[7px] text-[12.5px] font-bold whitespace-nowrap text-espresso-600 transition-colors hover:border-espresso-800 hover:bg-espresso-50 disabled:hover:border-espresso-200 disabled:hover:bg-transparent"
        >
          Pick a side
        </button>
      </div>
    </TicketCard>
  );
}

/**
 * multiple_choice: every option as a full-width row that opens the drawer primed with it.
 *
 * Deliberately carries no percentages or implied odds — this renders while betting is open, and
 * the pool split stays sealed until it closes. Even if it were available, showing it here would
 * turn "what can I back" into "what is everyone else backing," which is the herd behaviour the
 * sealed-odds rule exists to avoid in the first place.
 */
export function OptionsTicket({ options }: { options: MarketOption[] }) {
  const betslip = useBetslip();

  return (
    <TicketCard
      label="What you can back"
      meta={`${options.length} options`}
      bodyClassName="px-[18px] pt-[15px] pb-[18px]"
    >
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => betslip?.open({ optionId: o.id })}
            className="flex w-full items-center justify-between gap-2.5 rounded-[14px] border-[1.5px] border-espresso-100 bg-paper px-3.5 py-3 text-left text-sm font-bold text-espresso-600 transition-colors hover:border-espresso-800 hover:bg-espresso-50"
          >
            <span className="min-w-0 truncate">
              <OptionLabel label={o.label} />
            </span>
            <span className="shrink-0 text-xs font-bold text-espresso-400">Back this</span>
          </button>
        ))}
      </div>
    </TicketCard>
  );
}
