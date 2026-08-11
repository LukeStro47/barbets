import { TicketCard } from '@/components/markets/TicketCard';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { Mention } from '@/components/ui/Mention';
import type { MarketOption } from '@/lib/actions/markets';

/**
 * The endorsement screen's one ticket: everything the endorser is actually putting their name
 * behind, in one outlined card — the criteria they are judging, and who is on either side of it.
 *
 * The open-market template splits these across two cards (an explainer plus How it settles),
 * because a bettor is deciding what to back. An endorser is deciding one thing about one thing,
 * so splitting it would just be two cards where the screen only has one question in it.
 */
export function VouchingTicket({
  kindLabel,
  description,
  creatorNickname,
  subjectNicknames,
  options,
}: {
  /** "Yes / No", "Over / Under · line 12 min", "One of 4 options". */
  kindLabel: string;
  description: string;
  creatorNickname?: string;
  subjectNicknames: string[];
  /** multiple_choice only — an endorser can't vouch for options they can't see. */
  options?: MarketOption[] | null;
}) {
  return (
    <TicketCard label="You're vouching for" meta={kindLabel} bodyClassName="px-[18px] pt-4 pb-[18px]">
      <div className="space-y-3.5">
        <div>
          <p className="text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">How it settles</p>
          <p className="mt-1 text-[14.5px] leading-[1.45] text-espresso-700 text-pretty">{description}</p>
        </div>

        {options && options.length > 0 && (
          <div>
            <p className="text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">The options</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {options.map((o) => (
                <li
                  key={o.id}
                  className="rounded-[14px] border-[1.5px] border-espresso-100 bg-paper px-3.5 py-2.5 text-sm font-bold text-espresso-600"
                >
                  <OptionLabel label={o.label} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2 border-t border-espresso-50 pt-3.5">
          <VouchRow label="Started by">
            {creatorNickname ? <Mention nickname={creatorNickname} /> : <span className="not-italic">Unknown</span>}
          </VouchRow>
          {subjectNicknames.length > 0 && (
            <VouchRow label="Hidden from">
              {subjectNicknames.map((nickname, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <Mention nickname={nickname} />
                </span>
              ))}
            </VouchRow>
          )}
        </div>
      </div>
    </TicketCard>
  );
}

function VouchRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">{label}</span>
      <span className="min-w-0 truncate text-sm font-bold text-espresso-800">{children}</span>
    </div>
  );
}
