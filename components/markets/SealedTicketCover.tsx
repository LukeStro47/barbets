import { cn } from '@/lib/cn';
import { ClockIcon, LockIcon, UnlockIcon } from '@/components/ui/icons';

const CAPTION_STATIC = "Someone started a market about you. The question, the options, and who's betting stay hidden until it resolves.";
const CAPTION_OVERLAY = "This market about you has resolved. The question, the options, and who bet stay hidden until you tap to open it.";

function Wordmark() {
  return (
    <div className="flex items-center gap-[7px]">
      <img src="/barbets-mono-white.png" alt="" width={18} height={18} className="block" />
      <span className="text-xs font-extrabold tracking-[0.08em] text-honey-300 uppercase">Barbets</span>
    </div>
  );
}

function RedactedLines() {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      <span className="h-[17px] w-[88%] rounded-md animate-mystery-shimmer-dark" />
      <span className="h-[17px] w-[64%] rounded-md animate-mystery-shimmer-dark" style={{ animationDelay: '350ms' }} />
    </div>
  );
}

const HATCH = 'opacity-[0.14] bg-[repeating-linear-gradient(-45deg,#e8a33d_0_2px,transparent_2px_13px)]';

/** The perforation line + punch holes + wax seal, all centered on the exact boundary between the
 * two cover halves. An explicit z-index (rather than DOM order) is what keeps it painting above
 * both halves once tearing is underway — a CSS `transform` keyframe animating on the covers
 * promotes each into its own stacking context with an implicit z-index of 0, so this only needs
 * to beat that, not chase DOM order. Sits between the two halves in normal flow (static mode) so
 * its position tracks their real content height instead of a percentage guess.
 *
 * The seal shows a closed LockIcon pre-resolution (mode="static" — genuinely nothing to open
 * yet), or an UnlockIcon post-resolution (mode="overlay" — the market's already resolved, this
 * cover is just gating the reveal until tapped). Only the overlay, not-yet-tearing case is
 * actually clickable — everything else renders inert. */
function Seam({ mode, tearing, onOpen }: { mode: 'static' | 'overlay'; tearing?: boolean; onOpen?: () => void }) {
  const clickable = mode === 'overlay' && !tearing && !!onOpen;
  const sealClasses = cn(
    'flex h-[108px] w-[108px] items-center justify-center rounded-full border-[3px] border-[rgba(28,19,13,0.35)]',
    !tearing && 'animate-mystery-seal-glow',
    clickable && 'cursor-pointer transition-transform duration-150 hover:scale-[1.04] active:scale-95'
  );
  const sealStyle = { background: 'radial-gradient(circle at 34% 28%, #f1c480, #e8a33d 46%, #ac6f18)' };
  const sealInner = (
    <>
      <span className="absolute inset-[9px] rounded-full border-[1.5px] border-dashed border-[rgba(28,19,13,0.28)]" />
      {mode === 'static' ? (
        <LockIcon className="h-[42px] w-[42px] text-espresso-900" />
      ) : (
        <UnlockIcon className="h-[42px] w-[42px] text-espresso-900" />
      )}
    </>
  );

  return (
    <div className={cn('z-10', mode === 'overlay' ? 'absolute inset-x-0 top-[53%]' : 'relative', !clickable && 'pointer-events-none')}>
      <div className="relative border-t-2 border-dashed border-[rgba(241,196,128,0.45)]">
        <span className="absolute top-0 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
        <span className="absolute top-0 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
      </div>
      {clickable ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open the resolved market"
          className={cn('absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 border-0 p-0', sealClasses)}
          style={sealStyle}
        >
          {sealInner}
        </button>
      ) : (
        <div className={cn('absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2', sealClasses)} style={sealStyle}>
          {sealInner}
        </div>
      )}
    </div>
  );
}

export interface SealedTicketCoverProps {
  /** "[Group name] · About you" eyebrow text. */
  groupLabel: string;
  /** Optional "what you can see" 3-chip row (bets/volume/closes) — sealed ticket page only, omitted for the brief reveal-page tear overlay. */
  stats?: { label: string; value: React.ReactNode }[];
  /** 'static': a full self-contained sealed-ticket card (the pre-resolution page). 'overlay': absolutely fills a positioned parent, for covering an already-rendered RevealTicket. */
  mode: 'static' | 'overlay';
  /** overlay mode only: plays the shake+fly-off sequence once instead of the idle seal glow. */
  tearing?: boolean;
  /** overlay mode, not yet tearing: the seal becomes a real button that calls this to start the tear. */
  onOpen?: () => void;
  /** overlay mode + tearing only: fires once the fly-off animation finishes. */
  onTornComplete?: () => void;
}

export function SealedTicketCover({ groupLabel, stats, mode, tearing, onOpen, onTornComplete }: SealedTicketCoverProps) {
  const topHalf = (
    <div className={cn('overflow-hidden', mode === 'static' ? 'relative rounded-t-[28px]' : 'absolute inset-x-0 top-0 h-[53%] rounded-t-[28px]')}>
      <div
        className={cn(mode === 'overlay' ? 'absolute inset-0' : 'relative', tearing && 'animate-mystery-cover-top')}
        style={{ background: 'linear-gradient(150deg,#1c130d,#2c1f17 60%,#3b2a20)' }}
        onAnimationEnd={
          tearing
            ? (e) => {
                // The shorthand also runs the shorter seal-shake keyframe on this same element —
                // only the fly-off (the longer-running, delayed one) means the tear actually finished.
                if (e.animationName === 'mystery-cover-top-off') onTornComplete?.();
              }
            : undefined
        }
      >
        <div className={cn('absolute inset-0', HATCH)} />
        <div className="relative px-6 pt-6 pb-[78px]">
          <div className="mb-5 flex items-center justify-between">
            <Wordmark />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-honey-500/[0.16] px-2.5 py-1 text-[10.5px] font-extrabold tracking-[0.09em] text-honey-300 uppercase">
              {mode === 'static' ? 'Sealed' : 'Tap to open'}
            </span>
          </div>
          <p className="mb-3.5 text-[11.5px] font-bold tracking-[0.1em] text-honey-400 uppercase">{groupLabel}</p>
          <RedactedLines />
          <p className="text-[13.5px] leading-[1.5] text-paper-white/[0.62]">{mode === 'static' ? CAPTION_STATIC : CAPTION_OVERLAY}</p>
        </div>
      </div>
    </div>
  );

  const bottomHalf = (
    <div className={cn('overflow-hidden', mode === 'static' ? 'relative rounded-b-[28px]' : 'absolute inset-x-0 bottom-0 top-[53%] rounded-b-[28px]')}>
      <div
        className={cn(mode === 'overlay' ? 'absolute inset-0' : 'relative', tearing && 'animate-mystery-cover-bottom')}
        style={{ background: 'linear-gradient(150deg,#3b2a20,#2c1f17 70%,#1c130d)' }}
      >
        <div className={cn('absolute inset-0', HATCH)} />
        {stats && stats.length > 0 && (
          <div className="relative px-6 pt-[78px] pb-5">
            <p className="mb-2.5 text-[11px] font-bold tracking-[0.1em] text-honey-400 uppercase">About the Market</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {stats.map((s) => (
                <div key={s.label} className="rounded-[14px] bg-white/[0.07] px-3 py-2.5">
                  <p className="text-[10.5px] font-bold tracking-[0.07em] text-paper-white/45 uppercase">{s.label}</p>
                  <p className="mt-0.5 text-[17px] font-extrabold text-paper-white">{s.value}</p>
                </div>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-xs font-bold text-paper-white/50">
              <ClockIcon className="h-[13px] w-[13px] shrink-0" />
              Tap to open once it resolves.
            </p>
          </div>
        )}
        {!stats && <div className="pt-[38px]" />}
      </div>
    </div>
  );

  if (mode === 'static') {
    return (
      <div className="relative overflow-visible rounded-[28px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 text-paper-white shadow-lg shadow-espresso-950/25">
        {topHalf}
        <Seam mode="static" />
        {bottomHalf}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-10 overflow-hidden rounded-[28px]">
      {topHalf}
      {bottomHalf}
      <Seam mode="overlay" tearing={tearing} onOpen={onOpen} />
    </div>
  );
}
