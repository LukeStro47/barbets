'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useShareableImage } from '@/lib/shareImage';
import { formatTokens, formatPercent } from '@/lib/formatNumber';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ReactionBar } from '@/components/markets/ReactionBar';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { SealedTicketCover } from '@/components/markets/SealedTicketCover';
import { Button } from '@/components/ui/Button';
import { CheckIcon, DownloadIcon, ShareIcon } from '@/components/ui/icons';
import type { ReactionEmoji } from '@/lib/actions/reactions';

export interface TicketCaller {
  nickname: string;
  amount: number;
  payout: number;
}

export interface TicketOddsEntry {
  /** A bet_side in caps for yes_no/over_under, or an option's raw label for multiple_choice. */
  label: string;
  percent: number;
  /** multiple_choice only, since the two-segment bar always renders side A as the accent regardless of which side won. */
  isWinner?: boolean;
}

export interface RevealTicketProps {
  groupName: string;
  question: string;
  resolvedAtIso: string;
  /** 'VOIDED', a bet_side in caps, or the winning option's label, same convention as RevealSummary's headline. */
  headline: string;
  isVoid: boolean;
  isMultipleChoice: boolean;
  detailLine?: string | null;
  /** over_under only, shown as a small badge between the two odds labels. */
  line?: number | string | null;
  /** yes_no/over_under: exactly two entries, [sideA, sideB]. multiple_choice: every option, sorted by pool share. */
  odds: TicketOddsEntry[];
  /** The winning side/option's own percent, for the "N% called it wrong" caption. Omitted when there's no single clear winner share to quote. */
  winnerPercent?: number | null;
  /** Top winning bets by payout, already capped by the caller. */
  callers: TicketCaller[];
  /** Subject names, already formatted with a leading @ (e.g. "@marcus") since this renders as plain text, not <Mention>. */
  hiddenFrom: string[];
  groupId: string;
  marketId: string;
  reactionCounts: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
  reactionNicknames: Partial<Record<ReactionEmoji, string[]>>;
  myNickname: string;
  /** Whether the winning resolution proposal has a proof photo attached — only known ahead of time by the caller (server-fetched), since the photo itself is never fetched until someone taps the button. */
  hasProof: boolean;
  /** True when the viewer is a hidden subject of this market — the first time they open it after
   * resolution, a wax-sealed cover tears open over this same ticket instead of it just appearing
   * outright. Every other viewer (and this subject's second+ visit) renders exactly as before. */
  sealedForSubject?: boolean;
}

/** The yes_no/over_under outcome badge is a fixed-size circle — a short word like "YES" or "NO" sits comfortably at the full size, but "UNDER"/"VOIDED" need a smaller size (and tighter tracking) to avoid crowding the edge of the circle. */
function headlineBadgeTextClass(headline: string): string {
  if (headline.length <= 3) return 'text-[20px] tracking-[0.02em]';
  if (headline.length <= 5) return 'text-[16px] tracking-[0.01em]';
  return 'text-[13px] tracking-normal';
}

/** The shareable "betting slip" reveal card, plus the share actions bound to it. One component because the ref they both need has to live in the same tree. */
export function RevealTicket({
  groupName,
  question,
  resolvedAtIso,
  headline,
  isVoid,
  isMultipleChoice,
  detailLine,
  line,
  odds,
  winnerPercent,
  callers,
  hiddenFrom,
  groupId,
  marketId,
  reactionCounts,
  myReaction,
  reactionNicknames,
  myNickname,
  hasProof,
  sealedForSubject,
}: RevealTicketProps) {
  // Plays once: the very first time a subject opens this market after it resolved — but only on
  // tap, not automatically on mount. It used to auto-play, which raced BootSplash's fixed ~3s
  // display on a cold load: the whole ~1.5s tear could finish invisibly underneath it. Loading
  // covered (with an unlocked-padlock affordance) and waiting for a real click sidesteps that
  // entirely, since a click can only happen after the splash is long gone. `tearing` drives both
  // the cover's shake+fly-off and the ticket content's own entrance animations (it stays true
  // after the cover is gone — the CSS animations it triggers only ever play once per mount, so
  // there's nothing to reset). `coverVisible` is what actually renders SealedTicketCover; it
  // clears the moment the cover finishes flying off. `mystery-torn-${marketId}` is a per-device
  // localStorage flag, not a cross-device guarantee — acceptable here since the real data is
  // already fully on the client by the time this renders (RLS/is_market_visible() has already
  // lifted the wall), so replaying this on a second device or after clearing storage never leaks
  // anything, it's just seen twice.
  const [tearing, setTearing] = useState(false);
  const [coverVisible, setCoverVisible] = useState(false);
  const [barsRevealed, setBarsRevealed] = useState(false);
  const [captureGateOpen, setCaptureGateOpen] = useState(false);

  useEffect(() => {
    const key = `mystery-torn-${marketId}`;
    if (!sealedForSubject || localStorage.getItem(key) === '1') {
      setCaptureGateOpen(true);
      return;
    }
    setCoverVisible(true);
  }, [sealedForSubject, marketId]);

  useEffect(() => {
    if (!tearing) return;
    const barsTimer = setTimeout(() => setBarsRevealed(true), 750);
    // Opens once the tear has visually settled (cover gone, last staggered caller row done) —
    // sharing/saving a capture mid-animation would freeze an ugly half-faded frame.
    const captureTimer = setTimeout(() => setCaptureGateOpen(true), 2000);
    return () => {
      clearTimeout(barsTimer);
      clearTimeout(captureTimer);
    };
  }, [tearing]);

  // Always the image, never a link. There used to be a url/text `navigator.share()` rung in the
  // middle of this, which is what every Capacitor WebView viewer actually got (no
  // `navigator.canShare`, so the file rung was skipped) — a bare link to a page nobody outside the
  // group can open, in place of the one thing this ticket exists to be. `ready` holds the capture
  // until any tear animation has settled; sharing a half-faded frame would be worse than waiting.
  const {
    ref: ticketRef,
    status: shareStatus,
    reason: shareReason,
    canShare,
    share: handleShare,
  } = useShareableImage<HTMLDivElement>({
    filename: 'barbets-reveal.png',
    title: `${groupName} · ${question}`,
    text: `See how "${question}" resolved.`,
    ready: captureGateOpen,
  });

  const formattedDate = new Date(resolvedAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // While tearing, the odds bars start at 0% and fill in ~0.75s after the tear begins, same
  // fill-in technique as the demo walkthrough's odds bar — everyone else's bar just renders at
  // its real width immediately, like today.
  const barWidth = (percent: number) => (tearing && !barsRevealed ? 0 : percent);
  const barTransitionClass = tearing && 'transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]';

  return (
    <div>
      <div className="relative">
        <div
          ref={ticketRef}
          className={cn(
            'relative overflow-visible rounded-[28px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 text-paper-white shadow-lg shadow-espresso-950/25',
            tearing && 'animate-mystery-ticket-pop'
          )}
        >
        <div className="px-6 pt-6 pb-[18px]">
          <div className="mb-4 flex items-center gap-[7px]">
            {/* A plain <img>, not next/image, so html-to-image captures the exact same-origin asset with no optimization endpoint in the way. */}
            <img src="/barbets-mono-white.png" alt="" width={20} height={20} className="block" />
            <span className="text-[12.5px] font-extrabold tracking-[0.08em] text-honey-300 uppercase">Barbets</span>
          </div>

          <p className="mb-2 text-[11.5px] font-bold tracking-[0.1em] text-honey-400 uppercase">
            {groupName} &middot; {isVoid ? 'Voided' : 'Resolved'} {formattedDate}
          </p>
          <p
            className={cn(
              'mb-4 max-w-[88%] text-balance text-[25px] leading-[1.16] font-extrabold tracking-[-0.015em]',
              tearing && 'animate-mystery-question'
            )}
          >
            {question}
          </p>

          {line != null && (
            <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-honey-500/15 px-3.5 py-2 text-[15px] font-extrabold text-paper-white">
              Line: {line}
            </p>
          )}

          <div className={cn('flex items-center gap-3.5', isMultipleChoice && 'flex-col items-start gap-3')}>
            <div
              className={cn(
                'bg-honey-500 font-extrabold text-espresso-950 uppercase',
                isMultipleChoice
                  ? 'line-clamp-2 w-fit max-w-[240px] -rotate-3 rounded-[20px] px-[18px] py-[11px] text-center text-[15.5px] leading-[1.25] tracking-[0.02em]'
                  : cn(
                      'flex h-[74px] w-[74px] shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-espresso-950/20 px-1 text-center leading-[1.1] shadow-[0_8px_18px_-6px_rgba(232,163,61,0.55)]',
                      headlineBadgeTextClass(headline)
                    ),
                tearing && 'animate-mystery-badge'
              )}
            >
              <OptionLabel label={headline} />
            </div>
            {detailLine && (
              <p className={cn('text-[13.5px] leading-[1.45] text-paper-white/70', tearing && 'animate-mystery-detail')}>{detailLine}</p>
            )}
          </div>

          {hiddenFrom.length > 0 && (
            <p className={cn('mt-2.5 text-[12px] text-paper-white/45', tearing && 'animate-mystery-detail')}>
              Hidden from {hiddenFrom.join(', ')} until now.
            </p>
          )}
        </div>

        {(odds.length > 0 || callers.length > 0) && (
          <div className="relative border-t-2 border-dashed border-white/20">
            <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
            <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
          </div>
        )}

        <div className="px-6 pt-5 pb-[22px]">
          {odds.length > 0 && (
            <>
              <p className="mb-2.5 text-[11.5px] font-bold tracking-[0.1em] text-honey-400 uppercase">Odds at close</p>
              {isMultipleChoice ? (
                <ul className="mb-5 flex flex-col gap-[11px]">
                  {odds.map((o) => (
                    <li key={o.label}>
                      <div className="mb-1 flex items-baseline justify-between gap-2.5">
                        <span
                          className={cn(
                            'flex min-w-0 items-center gap-1 truncate text-[13px] font-bold',
                            o.isWinner ? 'text-paper-white' : 'text-paper-white/60'
                          )}
                        >
                          {o.isWinner && <CheckIcon className="h-[13px] w-[13px] shrink-0 text-honey-400" />}
                          <OptionLabel label={o.label} />
                        </span>
                        <span className={cn('shrink-0 text-[12.5px] font-extrabold', o.isWinner ? 'text-honey-300' : 'text-paper-white/45')}>
                          {o.percent}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={cn('h-full', o.isWinner ? 'bg-honey-500' : 'bg-white/25', barTransitionClass)}
                          style={{ width: `${barWidth(o.percent)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[13px] font-extrabold text-honey-300">
                      {odds[0].label} {odds[0].percent}%
                    </span>
                    <span className="text-[13px] font-extrabold text-paper-white/50">
                      {odds[1].label} {odds[1].percent}%
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
                    <div className={cn('h-full bg-honey-500', barTransitionClass)} style={{ width: `${barWidth(odds[0].percent)}%` }} />
                    <div className={cn('h-full bg-white/15', barTransitionClass)} style={{ width: `${barWidth(odds[1].percent)}%` }} />
                  </div>
                </>
              )}
              {winnerPercent != null && (
                <p className={cn('mt-[9px] mb-5 text-[13px] text-paper-white/60', tearing && 'animate-mystery-detail')}>
                  {formatPercent(100 - winnerPercent)}% called it wrong.
                </p>
              )}
            </>
          )}

          {callers.length > 0 ? (
            <>
              <p className="mb-2.5 text-[11.5px] font-bold tracking-[0.1em] text-honey-400 uppercase">Who called it</p>
              <ul className="flex flex-col gap-[9px]">
                {callers.map((c, i) => (
                  <li
                    key={c.nickname}
                    className={cn('flex items-center justify-between gap-2.5', tearing && 'animate-mystery-row')}
                    style={tearing ? { animationDelay: `${1000 + i * 130}ms` } : undefined}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-extrabold text-paper-white/70">
                        {i + 1}
                      </span>
                      <span className="truncate text-[14.5px] font-bold text-paper-white">@{c.nickname}</span>
                      <span className="shrink-0 text-[12.5px] text-paper-white/50">{formatTokens(c.amount)} &rarr;</span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-1.5">
                      <b className="text-[15px] font-extrabold text-honey-300">{formatTokens(c.payout)}</b>
                      <span className="text-[10.5px] font-bold text-paper-white/40">{(c.payout / c.amount).toFixed(1)}&times;</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-paper-white/55">{isVoid ? 'Every stake was refunded.' : 'Nobody predicted this one.'}</p>
          )}

          <div className="mt-5 flex flex-col items-center gap-2 border-t border-white/10 pt-4">
            <div className="flex items-center gap-1.5">
              <img src="/barbets-mono-white.png" alt="" width={15} height={15} />
              <span className="text-[11px] font-extrabold tracking-[0.07em] text-paper-white/55 uppercase">Barbets</span>
            </div>
            {/* The shareable domain, deliberately not the deployment's own URL — this ticket gets
                screenshotted and sent to people outside the app, and mybarbets.com is the address
                that's meant to outlive whatever Vercel deployment happens to be serving it. */}
            <span className="text-[10.5px] tracking-[0.02em] text-paper-white/30">mybarbets.com</span>
          </div>
        </div>
        </div>

        {coverVisible && (
          <SealedTicketCover
            groupLabel={`${groupName} · About you`}
            mode="overlay"
            tearing={tearing}
            onOpen={() => setTearing(true)}
            onTornComplete={() => {
              localStorage.setItem(`mystery-torn-${marketId}`, '1');
              setCoverVisible(false);
            }}
          />
        )}

        <ReactionBar
          groupId={groupId}
          marketId={marketId}
          counts={reactionCounts}
          myReaction={myReaction}
          nicknames={reactionNicknames}
          myNickname={myNickname}
        />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <Button
          onClick={handleShare}
          disabled={shareStatus === 'capturing' || shareStatus === 'working'}
          variant="accent"
          className="inline-flex flex-1 items-center justify-center gap-2"
        >
          {canShare ? <ShareIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
          {shareStatus === 'capturing'
            ? 'Preparing…'
            : shareStatus === 'working'
              ? 'Opening…'
              : shareStatus === 'failed'
                ? 'Try again'
                : canShare
                  ? 'Share'
                  : 'Save image'}
        </Button>
        {hasProof && <ResolutionProofButton marketId={marketId} variant="action" />}
      </div>
      {shareStatus === 'failed' && shareReason && (
        <p className="mt-1.5 text-center text-[11.5px] text-espresso-400">{shareReason}</p>
      )}
    </div>
  );
}
