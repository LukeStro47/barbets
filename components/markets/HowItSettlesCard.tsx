import type { ReactNode } from 'react';
import { Mention } from '@/components/ui/Mention';

export interface SettlesChipPeople {
  creator?: string;
  sponsor?: string | null;
  subjects?: string[];
}

/**
 * Slot 3 of the market template: the settlement criteria, plus the provenance chips that say who
 * stands behind this market and who it is hidden from. The criteria text reserves right padding
 * for the "?" clarification trigger, which `children` positions absolutely into this card's own
 * corner (`ClarificationRequests` owns that button and the pending-question list under it).
 */
export function HowItSettlesCard({
  description,
  people,
  note,
  children,
}: {
  description: string;
  people: SettlesChipPeople;
  /** Optional small print under the chips — currently the owner's void authority. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const { creator, sponsor, subjects = [] } = people;

  return (
    <div className="relative space-y-3 rounded-[24px] border border-hairline bg-surface p-5">
      <div className="pr-[34px]">
        <p className="text-[11.5px] font-extrabold tracking-[0.1em] text-faint uppercase">How it settles</p>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-muted text-pretty">{description}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {creator && <SettlesChip role="Started by">{<Mention nickname={creator} />}</SettlesChip>}
        {sponsor && <SettlesChip role="Endorsed by">{<Mention nickname={sponsor} />}</SettlesChip>}
        {subjects.length > 0 && (
          <SettlesChip role="Hidden from">
            {subjects.map((nickname, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <Mention nickname={nickname} />
              </span>
            ))}
          </SettlesChip>
        )}
      </div>

      {note && <p className="text-xs text-faint">{note}</p>}

      {children}
    </div>
  );
}

function SettlesChip({ role, children }: { role: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[8px] bg-canvas px-2.5 py-1 text-xs font-medium text-muted">
      <span className="text-faint">{role}</span>
      {children}
    </span>
  );
}
