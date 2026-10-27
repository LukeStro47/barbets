'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useShareableImage } from '@/lib/shareImage';
import { SHARE_BUTTONS_ENABLED } from '@/lib/flags';
import { logShareClick } from '@/lib/actions/shareClicks';
import { formatTokens, formatSignedTokens } from '@/lib/formatNumber';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { SealedTicketCover } from '@/components/markets/SealedTicketCover';
import { sideTitle } from '@/components/markets/MarketScreen';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Button } from '@/components/ui/Button';
import { RefreshIcon, DownloadIcon, ShareIcon } from '@/components/ui/icons';
import type { RevealBet } from '@/components/markets/RevealSummary';

export interface RevealTicketProps {
  groupName: string;
  question: string;
  /** 'VOIDED', a bet_side, or the winning option's label, same convention as RevealSummary's headline. */
  headline: string;
  isVoid: boolean;
  /** True for both a real void and a "nobody predicted this" refund — see RevealSummary. */
  refundish: boolean;
  detailLine?: string | null;
  /** over_under only, e.g. "26.2 mi". */
  line?: number | string | null;
  myBet: { amount: number; payout: number | null; isWinner: boolean } | null;
  pool: number;
  winnerCount: number;
  /** Up to 3 rows for "What everyone got" — the viewer's own bet plus the next highest payouts. */
  previewBets: RevealBet[];
  myNickname: string;
  /** Subject names, already formatted with a leading @. */
  hiddenFrom: string[];
  groupId: string;
  marketId: string;
  hasProof: boolean;
  /** True when the viewer is a hidden subject of this market — the first time they open it after
   * resolution, a sealed cover tears open over this card instead of it just appearing. */
  sealedForSubject?: boolean;
  /** Who called the result, for the proof row's "from @ellie". */
  proofByNickname?: string;
  /** The full ledger, rendered as the "All N bets and the ledger" footer of "What everyone got". */
  ledger?: React.ReactNode;
}

/**
 * 4m's result stack: the result card (green for a real winning side, neutral for a void or a
 * refund nobody won) with the proof photo as its own row, your own result on ink, and "What
 * everyone got" with the ledger one tap away at its foot. One component because the share
 * capture ref and the subject's tear-open cover both need to wrap exactly this.
 */
export function RevealTicket({
  groupName,
  question,
  headline,
  isVoid,
  refundish,
  detailLine,
  line,
  myBet,
  pool,
  winnerCount,
  previewBets,
  myNickname,
  hiddenFrom,
  groupId,
  marketId,
  hasProof,
  sealedForSubject,
  proofByNickname,
  ledger,
}: RevealTicketProps) {
  // Plays once: the first time a subject opens this market after it resolved, on tap (an
  // auto-play raced BootSplash on a cold load). `mystery-torn-${marketId}` is a per-device flag;
  // the data is already on the client by now, so replaying it elsewhere never leaks anything.
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
    const captureTimer = setTimeout(() => setCaptureGateOpen(true), 2000);
    return () => clearTimeout(captureTimer);
  }, [tearing]);

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

  const handleShareClick = () => {
    void logShareClick('reveal_ticket', groupId);
    handleShare();
  };

  const statValue = !myBet
    ? null
    : refundish
      ? formatTokens(myBet.payout ?? myBet.amount)
      : myBet.isWinner
        ? formatSignedTokens((myBet.payout ?? 0) - myBet.amount)
        : `−${formatTokens(myBet.amount)}`;

  const proofSub = [detailLine, line != null ? `Line ${line}` : null, proofByNickname ? `from @${proofByNickname}` : null].filter(Boolean).join(' · ');

  return (
    <div>
      <div className="relative">
        <div ref={ticketRef} className={cn('flex flex-col gap-[11px]', tearing && 'animate-mystery-ticket-pop')}>
          <div
            className={cn(
              'overflow-hidden rounded-[20px] border-[1.5px] bg-surface',
              refundish ? 'border-hairline' : 'border-gain-line shadow-[0_8px_20px_-16px_rgba(11,138,91,0.7)]',
              tearing && 'animate-mystery-detail'
            )}
          >
            <div className={cn('flex items-center gap-3 px-4 py-[15px]', refundish ? 'bg-tile' : 'bg-gain-bg')}>
              <span className={cn('flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px]', refundish ? 'bg-faint' : 'bg-gain')}>
                {refundish ? (
                  <RefreshIcon className="h-4 w-4 text-surface" />
                ) : (
                  <svg width="17" height="17" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M2 6.3 4.6 9 10 3.2" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[10.5px] font-bold tracking-[0.1em] uppercase', refundish ? 'text-muted' : 'text-gain')}>
                  {isVoid ? 'Voided' : refundish ? 'Result' : 'Winning side'}
                </span>
                <span className="mt-[3px] block text-[19px] font-extrabold tracking-[-0.015em] text-ink text-pretty">
                  {isVoid ? 'Every stake went back.' : <OptionLabel label={headline} />}
                </span>
              </span>
            </div>
            {hasProof ? (
              <div className="flex items-center gap-[11px] px-4 py-[11px]">
                <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-rule text-muted">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8h3l1.4-2h7.2L17 8h3v11H4z" />
                    <circle cx="12" cy="13" r="3.4" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">Photo proof attached</span>
                  {proofSub && <span className="mt-px block truncate text-[11.5px] text-faint">{proofSub}</span>}
                </span>
                <ResolutionProofButton marketId={marketId} variant="view" />
              </div>
            ) : (
              (detailLine || line != null) && (
                <div className="border-t border-rule px-4 py-3 text-[12.5px] leading-[1.5] text-muted">
                  {line != null && <p>Line: {line}</p>}
                  {detailLine && <p>{detailLine}</p>}
                </div>
              )
            )}
          </div>

          {hiddenFrom.length > 0 && (
            <p className={cn('px-1 text-[12px] text-faint', tearing && 'animate-mystery-detail')}>Hidden from {hiddenFrom.join(', ')} until now.</p>
          )}

          {myBet && statValue && (
            <div className={cn('flex items-end justify-between gap-3 rounded-[20px] bg-ink px-[18px] py-4', tearing && 'animate-mystery-detail')}>
              <span className="min-w-0">
                <span className="block text-[10.5px] font-bold tracking-[0.1em] text-surface/50 uppercase">
                  {refundish ? 'Refunded' : myBet.isWinner ? 'You won' : 'You lost'}
                </span>
                <span className="mt-1.5 block font-mono text-[32px] leading-none font-semibold tracking-[-0.02em] text-surface">{statValue}</span>
              </span>
              <span className="shrink-0 text-right font-mono text-[12px] leading-[1.5] text-surface/60">
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
            <div className="flex items-baseline justify-between gap-2.5 border-b border-rule px-4 pt-3 pb-2.5">
              <p className="text-[10.5px] font-bold tracking-[0.1em] whitespace-nowrap text-faint uppercase">What everyone got</p>
              <span className="shrink-0 font-mono text-[11.5px] whitespace-nowrap text-faint">
                {formatTokens(pool)} pool · {winnerCount} won
              </span>
            </div>
            {previewBets.length > 0 ? (
              previewBets.map((b, i) => {
                const mine = b.nickname === myNickname;
                return (
                  <div
                    key={`${b.nickname}:${b.choiceLabel}`}
                    className={cn(
                      'flex items-center gap-[9px] border-b border-row-rule px-4 py-2.5',
                      mine && 'bg-signal-wash shadow-[inset_3px_0_0_var(--color-signal)]',
                      tearing && 'animate-mystery-row'
                    )}
                    style={tearing ? { animationDelay: `${i * 90}ms` } : undefined}
                  >
                    {b.userId ? (
                      <UserAvatar
                        userId={b.userId}
                        nickname={b.nickname}
                        avatarUpdatedAt={b.avatarUpdatedAt ?? null}
                        avatarPresetKey={b.avatarPresetKey ?? null}
                        className="h-6 w-6 text-[9px]"
                        fallbackClassName="bg-tile text-muted"
                      />
                    ) : (
                      <span className="h-6 w-6 shrink-0 rounded-full bg-tile" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">@{b.nickname}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">
                      <OptionLabel label={sideTitle(b.choiceLabel)} /> {formatTokens(b.amount)}
                    </span>
                    <span
                      className={cn(
                        'w-[52px] shrink-0 text-right font-mono text-[12.5px] font-semibold',
                        refundish ? 'text-faint' : b.isWinner ? 'text-gain' : 'text-alert'
                      )}
                    >
                      {refundish
                        ? formatTokens(b.payout ?? b.amount)
                        : b.isWinner
                          ? formatSignedTokens((b.payout ?? 0) - b.amount)
                          : `−${formatTokens(b.amount)}`}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="border-b border-row-rule px-4 py-3 text-[13px] text-faint">Nobody bet on this one.</p>
            )}
            {ledger}
          </div>

          {/* Only inside the capture when sharing is on — the one line that says whose result
              this is once the image is outside the app. */}
          {SHARE_BUTTONS_ENABLED && (
            <p className="pt-1 text-center text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Barbets · mybarbets.com</p>
          )}
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
