'use client';

import { useEffect, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ReactionBar } from '@/components/markets/ReactionBar';
import { Button } from '@/components/ui/Button';
import { CheckIcon, DownloadIcon, LinkIcon, ShareIcon } from '@/components/ui/icons';
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
}: RevealTicketProps) {
  const ticketRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [capturing, setCapturing] = useState(true);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
      setCanShareFiles(
        typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  useEffect(() => {
    // Captured eagerly on mount, not lazily on click: html-to-image's toBlob
    // is async, and an await between a click and navigator.share() risks
    // losing the user-activation Safari requires for the native share sheet.
    // Pre-capturing means the click handlers below use an already-ready blob.
    let cancelled = false;
    const node = ticketRef.current;
    if (!node) return;
    document.fonts.ready
      .then(() => toBlob(node, { pixelRatio: 2, cacheBust: true }))
      .then((result) => {
        if (!cancelled) {
          setBlob(result);
          setCapturing(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCapturing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function downloadBlob(b: Blob) {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'barbets-reveal.png';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleShare() {
    if (!blob) return;
    const file = new File([blob], 'barbets-reveal.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: `${groupName} · ${question}`, text: `See how "${question}" resolved.` });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') downloadBlob(blob);
    }
  }

  function handleSaveImage() {
    if (blob) downloadBlob(blob);
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const formattedDate = new Date(resolvedAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div>
      <div className="relative">
        <div
          ref={ticketRef}
          className="relative overflow-visible rounded-[28px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 text-paper-white shadow-lg shadow-espresso-950/25"
        >
        <div className="px-6 pt-6 pb-[18px]">
          <div className="mb-4 flex items-center gap-[7px]">
            {/* A plain <img>, not next/image, so html-to-image captures the exact same-origin asset with no optimization endpoint in the way. */}
            <img src="/barbets-coin.png" alt="" width={20} height={20} className="block" />
            <span className="text-[12.5px] font-extrabold tracking-[0.08em] text-honey-300 uppercase">Barbets</span>
          </div>

          <p className="mb-2 text-[11.5px] font-bold tracking-[0.1em] text-honey-400 uppercase">
            {groupName} &middot; {isVoid ? 'Voided' : 'Resolved'} {formattedDate}
          </p>
          <p className="mb-4 max-w-[88%] text-balance text-[25px] leading-[1.16] font-extrabold tracking-[-0.015em]">{question}</p>

          <div className={cn('flex items-center gap-3.5', isMultipleChoice && 'flex-col items-start gap-3')}>
            <div
              className={cn(
                'bg-honey-500 font-extrabold tracking-[0.02em] text-espresso-950 uppercase',
                isMultipleChoice
                  ? 'line-clamp-2 w-fit max-w-[240px] -rotate-3 rounded-[20px] px-[18px] py-[11px] text-center text-[15.5px] leading-[1.25]'
                  : 'flex h-[74px] w-[74px] shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-espresso-950/20 text-[20px] shadow-[0_8px_18px_-6px_rgba(232,163,61,0.55)]'
              )}
            >
              <OptionLabel label={headline} />
            </div>
            {detailLine && <p className="text-[13.5px] leading-[1.45] text-paper-white/70">{detailLine}</p>}
          </div>

          {hiddenFrom.length > 0 && (
            <p className="mt-2.5 text-[12px] text-paper-white/45">Hidden from {hiddenFrom.join(', ')} until now.</p>
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
                        <div className={cn('h-full', o.isWinner ? 'bg-honey-500' : 'bg-white/25')} style={{ width: `${o.percent}%` }} />
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
                    {line != null && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-paper-white/70">{line}</span>
                    )}
                    <span className="text-[13px] font-extrabold text-paper-white/50">
                      {odds[1].label} {odds[1].percent}%
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-honey-500" style={{ width: `${odds[0].percent}%` }} />
                    <div className="h-full bg-white/15" style={{ width: `${odds[1].percent}%` }} />
                  </div>
                </>
              )}
              {winnerPercent != null && <p className="mt-[9px] mb-5 text-[13px] text-paper-white/60">{100 - winnerPercent}% called it wrong.</p>}
            </>
          )}

          {callers.length > 0 ? (
            <>
              <p className="mb-2.5 text-[11.5px] font-bold tracking-[0.1em] text-honey-400 uppercase">Who called it</p>
              <ul className="flex flex-col gap-[9px]">
                {callers.map((c, i) => (
                  <li key={c.nickname} className="flex items-center justify-between gap-2.5">
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
              <img src="/barbets-coin.png" alt="" width={15} height={15} />
              <span className="text-[11px] font-extrabold tracking-[0.07em] text-paper-white/55 uppercase">Barbets</span>
            </div>
            <span className="text-[10.5px] tracking-[0.02em] text-paper-white/30">mybarbets.com</span>
          </div>
        </div>
        </div>

        <ReactionBar
          groupId={groupId}
          marketId={marketId}
          counts={reactionCounts}
          myReaction={myReaction}
          nicknames={reactionNicknames}
          myNickname={myNickname}
        />
      </div>

      <div className="mt-3.5 flex gap-2">
        {canShareFiles ? (
          <Button onClick={handleShare} disabled={capturing} variant="accent" className="inline-flex w-full items-center justify-center gap-2">
            <ShareIcon className="h-4 w-4" />
            {capturing ? 'Preparing…' : 'Share'}
          </Button>
        ) : (
          <>
            <Button onClick={handleSaveImage} disabled={capturing} variant="accent" className="inline-flex flex-1 items-center justify-center gap-2">
              <DownloadIcon className="h-4 w-4" />
              {capturing ? 'Preparing…' : 'Save image'}
            </Button>
            <Button onClick={handleCopyLink} variant="outline" className="inline-flex flex-1 items-center justify-center gap-2">
              <LinkIcon className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
