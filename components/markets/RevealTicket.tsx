'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useShareableImage } from '@/lib/shareImage';
import { SHARE_BUTTONS_ENABLED } from '@/lib/flags';
import { logShareClick } from '@/lib/actions/shareClicks';
import { formatTokens, formatSignedTokens } from '@/lib/formatNumber';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ReactionBar } from '@/components/markets/ReactionBar';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { SealedTicketCover } from '@/components/markets/SealedTicketCover';
import { Button } from '@/components/ui/Button';
import { CheckCircleIcon, RefreshIcon, DownloadIcon, ShareIcon } from '@/components/ui/icons';
import type { ReactionEmoji } from '@/lib/actions/reactions';
import type { RevealBet } from '@/components/markets/RevealSummary';

export interface RevealTicketProps {
  groupName: string;
  question: string;
  resolvedAtIso: string;
  /** 'VOIDED', a bet_side in caps, or the winning option's label, same convention as RevealSummary's headline. */
  headline: string;
  isVoid: boolean;
  /** True for both a real void and a "nobody predicted this" refund — see RevealSummary's `refundish`. Governs the result card's tone (neutral, not a win) and the stat card's framing ("Refunded", not "You won"). */
  refundish: boolean;
  detailLine?: string | null;
  /** over_under only, e.g. "26.2 mi". */
  line?: number | string | null;
  /** The viewer's own bet on this market, or null if they never bet — the stat card renders nothing without one. */
  myBet: { amount: number; payout: number | null; isWinner: boolean } | null;
  /** Total tokens staked across every bet. */
  pool: number;
  winnerCount: number;
  totalBets: number;
  /** Up to 3 rows for "What everyone got" — the viewer's own bet plus the next highest payouts, already assembled by the caller. */
  previewBets: RevealBet[];
  myNickname: string;
  /** Subject names, already formatted with a leading @ (e.g. "@marcus") since this renders as plain text, not <Mention>. */
  hiddenFrom: string[];
  groupId: string;
  marketId: string;
  reactionCounts: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
  reactionNicknames: Partial<Record<ReactionEmoji, string[]>>;
  /** Whether the winning resolution proposal has a proof photo attached — only known ahead of time by the caller (server-fetched), since the photo itself is never fetched until someone taps the button. */
  hasProof: boolean;
  /** True when the viewer is a hidden subject of this market — the first time they open it after
   * resolution, a wax-sealed cover tears open over this same card instead of it just appearing
   * outright. Every other viewer (and this subject's second+ visit) renders exactly as before. */
  sealedForSubject?: boolean;
}

/** The reveal screen's result card, stat card, "what everyone got" preview, and reactions row —
 * plus the share/proof actions bound to it. One component because the ref they both need has to
 * live in the same tree. Everything here sits behind the sealed subject's tear-open cover, same
 * footprint as before; the full bet-by-bet ledger (SettlementLedger) and the comment count stay
 * outside it, in RevealSummary, matching the precedent that ledger detail was never itself gated. */
export function RevealTicket({
  groupName,
  question,
  resolvedAtIso,
  headline,
  isVoid,
  refundish,
  detailLine,
  line,
  myBet,
  pool,
  winnerCount,
  totalBets,
  previewBets,
  myNickname,
  hiddenFrom,
  groupId,
  marketId,
  reactionCounts,
  myReaction,
  reactionNicknames,
  hasProof,
  sealedForSubject,
}: RevealTicketProps) {
  // Plays once: the very first time a subject opens this market after it resolved — but only on
  // tap, not automatically on mount. It used to auto-play, which raced BootSplash's fixed ~3s
  // display on a cold load: the whole ~1.5s tear could finish invisibly underneath it. Loading
  // covered (with an unlocked-padlock affordance) and waiting for a real click sidesteps that
  // entirely, since a click can only happen after the splash is long gone. `tearing` drives both
  // the cover's shake+fly-off and the card content's own entrance animations (it stays true
  // after the cover is gone — the CSS animations it triggers only ever play once per mount, so
  // there's nothing to reset). `coverVisible` is what actually renders SealedTicketCover; it
  // clears the moment the cover finishes flying off. `mystery-torn-${marketId}` is a per-device
  // localStorage flag, not a cross-device guarantee — acceptable here since the real data is
  // already fully on the client by the time this renders (RLS/is_market_visible() has already
  // lifted the wall), so replaying this on a second device or after clearing storage never leaks
  // anything, it's just seen twice.
  const [tearing, setTearing] = useState(false);
  const [coverVisible, setCoverVisible] = useState(false);
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
    // Opens once the tear has visually settled (cover gone, last staggered row done) —
    // sharing/saving a capture mid-animation would freeze an ugly half-faded frame.
    const captureTimer = setTimeout(() => setCaptureGateOpen(true), 2000);
    return () => clearTimeout(captureTimer);
  }, [tearing]);

  // Always the image, never a link. There used to be a url/text `navigator.share()` rung in the
  // middle of this, which is what every Capacitor WebView viewer actually got (no
  // `navigator.canShare`, so the file rung was skipped) — a bare link to a page nobody outside the
  // group can open, in place of the one thing this card exists to be. `ready` holds the capture
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

  // Logged on click intent, not on successful completion — Web Share API's promise
  // resolves on a completed share and rejects on cancel, but "clicked" is what the
  // frequency-of-use tracking this feeds actually wants to know.
  const handleShareClick = () => {
    void logShareClick('reveal_ticket', groupId);
    handleShare();
  };

  const formattedDate = new Date(resolvedAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const statValue = !myBet
    ? null
    : refundish
      ? `+${formatTokens(myBet.payout ?? myBet.amount)}`
      : myBet.isWinner
        ? formatSignedTokens((myBet.payout ?? 0) - myBet.amount)
        : `−${formatTokens(myBet.amount)}`;

  return (
    <div>
      <div className="relative">
        <div ref={ticketRef} className={cn('flex flex-col gap-3', tearing && 'animate-mystery-ticket-pop')}>
          <div>
            <p className="mb-1.5 text-[11.5px] font-bold tracking-[0.1em] text-signal uppercase">
              {groupName} &middot; {isVoid ? 'Voided' : 'Resolved'} {formattedDate}
            </p>
            <p
              className={cn(
                'text-balance text-[22px] leading-[1.2] font-extrabold tracking-[-0.015em] text-ink',
                tearing && 'animate-mystery-question'
              )}
            >
              {question}
            </p>
            {hiddenFrom.length > 0 && (
              <p className={cn('mt-1.5 text-[12px] text-faint', tearing && 'animate-mystery-detail')}>
                Hidden from {hiddenFrom.join(', ')} until now.
              </p>
            )}
          </div>

          <div
            className={cn(
              'overflow-hidden rounded-[20px] border bg-surface',
              refundish ? 'border-hairline' : 'border-gain-line',
              tearing && 'animate-mystery-detail'
            )}
          >
            <div className={cn('flex items-center gap-3 px-4 py-[15px]', refundish ? 'bg-rule' : 'bg-gain-bg')}>
              <span
                className={cn(
                  'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px]',
                  refundish ? 'bg-dash' : 'bg-gain'
                )}
              >
                {refundish ? (
                  <RefreshIcon className="h-4 w-4 text-surface" />
                ) : (
                  <CheckCircleIcon className="h-[18px] w-[18px] text-surface" />
                )}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-[10.5px] font-bold tracking-[0.1em] uppercase', refundish ? 'text-muted' : 'text-gain')}>
                  {isVoid ? 'Voided' : refundish ? 'Result' : 'Winning side'}
                </span>
                <span className="mt-0.5 block text-[17px] font-extrabold tracking-[-0.01em] text-ink">
                  {isVoid ? 'Every stake was refunded.' : <OptionLabel label={headline} />}
                </span>
              </span>
            </div>
            {(detailLine || line != null) && (
              <div className="space-y-1 border-t border-rule px-4 py-3 text-[12.5px] leading-[1.5] text-muted">
                {line != null && <p>Line: {line}</p>}
                {detailLine && <p>{detailLine}</p>}
              </div>
            )}
            {hasProof && (
              <div className="border-t border-rule px-4 py-3">
                <ResolutionProofButton marketId={marketId} variant="chip" />
              </div>
            )}
          </div>

          {myBet && statValue && (
            <div className={cn('flex items-end justify-between gap-3 rounded-[20px] bg-ink px-[18px] py-4', tearing && 'animate-mystery-detail')}>
              <span>
                <span className="text-[10.5px] font-bold tracking-[0.1em] text-surface/50 uppercase">
                  {refundish ? 'Refunded' : myBet.isWinner ? 'You won' : 'You lost'}
                </span>
                <span className="mt-1.5 block font-mono text-[28px] font-semibold tracking-[-0.02em] text-on-ink">{statValue}</span>
              </span>
              <span className="shrink-0 text-right font-mono text-[11.5px] leading-[1.5] text-surface/60">
                {formatTokens(myBet.amount)} staked
                {!refundish && myBet.isWinner && (
                  <>
                    <br />
                    {formatTokens(myBet.payout ?? 0)} back
                  </>
                )}
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-[20px] border border-hairline bg-surface">
            <div className="flex items-baseline justify-between gap-2.5 border-b border-rule px-4 py-2.5">
              <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">What everyone got</p>
              <span className="shrink-0 font-mono text-[11.5px] text-faint">
                {formatTokens(pool)} pool &middot; {winnerCount} won
              </span>
            </div>
            {previewBets.length > 0 ? (
              previewBets.map((b, i) => (
                <div
                  key={b.nickname}
                  className={cn(
                    'flex items-center gap-2.5 border-b border-[#f4f6f8] px-4 py-2.5 last:border-b-0',
                    b.nickname === myNickname && 'bg-signal-tint',
                    tearing && 'animate-mystery-row'
                  )}
                  style={tearing ? { animationDelay: `${i * 90}ms` } : undefined}
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">@{b.nickname}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">
                    <OptionLabel label={b.choiceLabel.toUpperCase()} /> {formatTokens(b.amount)}
                  </span>
                  <span
                    className={cn(
                      'w-[56px] shrink-0 text-right font-mono text-[12.5px] font-semibold',
                      b.isWinner ? 'text-gain' : 'text-faint'
                    )}
                  >
                    {b.isWinner ? formatSignedTokens((b.payout ?? 0) - b.amount) : `−${formatTokens(b.amount)}`}
                  </span>
                </div>
              ))
            ) : (
              <p className="px-4 py-3 text-[13px] text-faint">Nobody bet on this one.</p>
            )}
            {totalBets > 0 && (
              <div className="bg-canvas px-4 py-[11px] text-[12px] text-faint">
                {totalBets} bet{totalBets === 1 ? '' : 's'} total
              </div>
            )}
          </div>

          <div className={tearing ? 'animate-mystery-row' : undefined} style={tearing ? { animationDelay: `${previewBets.length * 90}ms` } : undefined}>
            <ReactionBar
              groupId={groupId}
              marketId={marketId}
              counts={reactionCounts}
              myReaction={myReaction}
              nicknames={reactionNicknames}
              myNickname={myNickname}
            />
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
      </div>

      {SHARE_BUTTONS_ENABLED && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <Button
            onClick={handleShareClick}
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
        </div>
      )}
      {SHARE_BUTTONS_ENABLED && shareStatus === 'failed' && shareReason && (
        <p className="mt-1.5 text-center text-[11.5px] text-faint">{shareReason}</p>
      )}
    </div>
  );
}
