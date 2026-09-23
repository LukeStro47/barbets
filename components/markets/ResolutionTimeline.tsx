import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { Mention } from '@/components/ui/Mention';

export type ResolutionStage = 'pending_sponsor' | 'endorsing' | 'open' | 'closed' | 'proposed' | 'disputed';

/** Static "what happens next" explainer — answers the question every in-flight market raises
 * (so when do I find out?) in one glance, replacing the resolution-window prose that used to
 * be scattered across cards. `stage` picks the step list and which one reads as "current":
 * a brand-new market gets the full roadmap from endorsement onward, while a closed/disputed
 * one only shows what's actually still ahead of it. */
export function ResolutionTimeline({
  resolutionWindowHours,
  stage = 'closed',
  proposerNickname,
  bettingRunsUntil,
  children,
}: {
  resolutionWindowHours: number;
  stage?: ResolutionStage;
  /** 'proposed' only — names who made the call in step 1 instead of a vague "someone". */
  proposerNickname?: string;
  /** 'endorsing' only — markets.closes_at, so step 1 can say how long betting will actually run. */
  bettingRunsUntil?: string;
  /** The stage's one action, rendered under a divider below the steps: "Propose result early"
   * while open, "Challenge this call" once proposed. Never paired with descriptive text and
   * never sharing a row — the steps above are the explanation. */
  children?: React.ReactNode;
}) {
  const windowLabel = resolutionWindowHours < 1 ? `${Math.round(resolutionWindowHours * 60)} minutes` : `${resolutionWindowHours} hours`;

  const bettingWindowLabel = bettingRunsUntil ? <CountdownTimer target={bettingRunsUntil} prefix="" /> : 'a while';

  const proposeStep = (
    <>
      <strong className="text-ink">Someone proposes</strong> what happened, with proof if they have it.
    </>
  );
  const challengeStep = (
    <>
      Everyone gets <strong className="text-muted">{windowLabel} to challenge</strong> it. A challenge goes to a secret vote.
    </>
  );
  const payoutStep = <>The pool pays out and the ticket unseals.</>;

  let steps: React.ReactNode[];
  let currentIndex: number;

  switch (stage) {
    case 'pending_sponsor':
      steps = [
        <>
          <strong className="text-ink">A second member endorses</strong> this market before betting can open.
        </>,
        <>Betting opens and stays open until it closes, or someone proposes early.</>,
        proposeStep,
        <>A challenge goes to a secret vote, then the pool pays out and the ticket unseals.</>,
      ];
      currentIndex = 0;
      break;
    // The same lifecycle as 'pending_sponsor', minus the endorsement step and rewritten from
    // the endorser's own point of view — on the endorsement screen the viewer *is* step one, so
    // listing it as something they're waiting on reads as though someone else has to act.
    case 'endorsing':
      steps = [
        <>
          Betting opens right away and runs for <strong className="text-ink">{bettingWindowLabel}</strong>, unless
          someone calls it early.
        </>,
        <>Someone proposes what happened, with proof if they have it.</>,
        <>
          The group gets {windowLabel} to challenge, then the pool pays out and the ticket unseals.
        </>,
      ];
      currentIndex = 0;
      break;
    case 'open':
      steps = [<>Betting is open until it closes, or someone proposes early.</>, proposeStep, challengeStep, payoutStep];
      currentIndex = 0;
      break;
    case 'proposed':
      steps = [
        <>
          {proposerNickname ? <Mention nickname={proposerNickname} /> : 'Someone'} proposed what happened.
        </>,
        challengeStep,
        payoutStep,
      ];
      currentIndex = 1;
      break;
    case 'disputed':
      steps = [
        <>Someone proposed what happened.</>,
        <>
          A challenge moved it to a <strong className="text-muted">secret vote</strong>. Ballots stay hidden until it closes.
        </>,
        payoutStep,
      ];
      currentIndex = 1;
      break;
    default:
      steps = [proposeStep, challengeStep, payoutStep];
      currentIndex = 0;
  }

  return (
    <div>
      <p className="mb-2.5 text-[11.5px] font-extrabold tracking-[0.08em] text-faint uppercase">
        {stage === 'endorsing' ? 'After you endorse' : 'What happens next'}
      </p>
      <div className="flex flex-col">
        {steps.map((step, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isLast = i === steps.length - 1;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center pt-[3px]">
                <span
                  className={
                    isDone || isCurrent
                      ? 'h-[9px] w-[9px] shrink-0 rounded-full bg-ink'
                      : 'h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] border-hairline bg-canvas'
                  }
                />
                {!isLast && <span className="w-[1.5px] flex-1 bg-rule" />}
              </div>
              <p
                className={`text-[13.5px] leading-[1.4] ${isLast ? '' : 'mb-3'} ${
                  isCurrent ? 'text-muted' : isDone ? 'text-muted' : 'text-muted'
                }`}
              >
                {step}
              </p>
            </div>
          );
        })}
      </div>
      {children && <div className="mt-3 border-t border-rule pt-3.5">{children}</div>}
    </div>
  );
}
