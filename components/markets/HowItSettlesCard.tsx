import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Mention } from '@/components/ui/Mention';

export interface SettlesChipPeople {
  creator?: string;
  sponsor?: string | null;
  subjects?: string[];
}

/**
 * Slot 3 of the market template: the resolution criteria, plus a "Hidden from" chip when the
 * market has subjects. Started-by/Endorsed-by attribution moved up to the page header's subtitle
 * (matching 4d's own "Started by @ellie · Endorsed by @marcus" line under the title) — this card
 * used to carry that as chips alongside "Hidden from" too, which the actual mockup doesn't show
 * here at all. The criteria text reserves right padding for the "?" clarification trigger, which
 * `children` positions absolutely into this card's own corner (`ClarificationRequests` owns that
 * button and the pending-question list under it).
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
  const { subjects = [] } = people;

  return (
    <Card className="relative space-y-3">
      <div>
        <p className="max-w-[calc(100%-118px)] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Resolution criteria</p>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted text-pretty">{description}</p>
      </div>

      {subjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <SettlesChip role="Hidden from">
            {subjects.map((nickname, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <Mention nickname={nickname} />
              </span>
            ))}
          </SettlesChip>
        </div>
      )}

      {note && <p className="text-xs text-faint">{note}</p>}

      {children}
    </Card>
  );
}

function SettlesChip({ role, children }: { role: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rule px-2.5 py-1 text-xs font-medium text-muted">
      <span className="text-faint">{role}</span>
      {children}
    </span>
  );
}
