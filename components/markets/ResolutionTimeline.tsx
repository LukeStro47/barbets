export type ResolutionStage = 'pending_sponsor' | 'open' | 'closed' | 'disputed';

/** Static "what happens next" explainer — answers the question every in-flight market raises
 * (so when do I find out?) in one glance, replacing the resolution-window prose that used to
 * be scattered across cards. `stage` picks the step list and which one reads as "current":
 * a brand-new market gets the full roadmap from endorsement onward, while a closed/disputed
 * one only shows what's actually still ahead of it. */
export function ResolutionTimeline({
  resolutionWindowHours,
  stage = 'closed',
}: {
  resolutionWindowHours: number;
  stage?: ResolutionStage;
}) {
  const windowLabel = resolutionWindowHours < 1 ? `${Math.round(resolutionWindowHours * 60)} minutes` : `${resolutionWindowHours} hours`;

  const proposeStep = (
    <>
      <strong className="text-espresso-900">Someone proposes</strong> what happened, with proof if they have it.
    </>
  );
  const challengeStep = (
    <>
      Everyone gets <strong className="text-espresso-700">{windowLabel} to challenge</strong> it. A challenge goes to a secret vote.
    </>
  );
  const payoutStep = <>The pool pays out and the ticket unseals.</>;

  let steps: React.ReactNode[];
  let currentIndex: number;

  switch (stage) {
    case 'pending_sponsor':
      steps = [
        <>
          <strong className="text-espresso-900">A second member endorses</strong> this market before betting can open.
        </>,
        <>Betting opens and stays open until it closes, or someone proposes early.</>,
        proposeStep,
        <>A challenge goes to a secret vote, then the pool pays out and the ticket unseals.</>,
      ];
      currentIndex = 0;
      break;
    case 'open':
      steps = [<>Betting is open until it closes, or someone proposes early.</>, proposeStep, challengeStep, payoutStep];
      currentIndex = 0;
      break;
    case 'disputed':
      steps = [
        <>Someone proposed what happened.</>,
        <>
          A challenge moved it to a <strong className="text-espresso-700">secret vote</strong>. Ballots stay hidden until it closes.
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
      <p className="mb-2.5 text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">What happens next</p>
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
                      ? 'h-[9px] w-[9px] shrink-0 rounded-full bg-espresso-800'
                      : 'h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] border-espresso-200 bg-paper'
                  }
                />
                {!isLast && <span className="w-[1.5px] flex-1 bg-espresso-100" />}
              </div>
              <p
                className={`mb-3 text-[13.5px] leading-[1.4] ${
                  isCurrent ? 'text-espresso-700' : isDone ? 'text-espresso-600' : 'text-espresso-500'
                }`}
              >
                {step}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
