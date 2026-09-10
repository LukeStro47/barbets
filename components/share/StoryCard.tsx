'use client';

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { CloseIcon, DownloadIcon, ShareIcon } from '@/components/ui/icons';
import type { ShareableImageStatus } from '@/lib/shareImage';

/**
 * The story-sized (9:16) shareable card family: the "called it" card a resolved market offers and
 * every card of a season's Wrapped. All of them are captured through the same
 * `useShareableImage()` in lib/shareImage.ts the reveal ticket and the record card use; this file
 * only holds the shell they share and the preview/overlay chrome around it.
 *
 * Laid out at 540x960 CSS pixels on purpose. `useShareableImage()` captures at `pixelRatio: 2`, so
 * the PNG that reaches the share sheet is exactly 1080x1920, Instagram Stories' native size,
 * without asking html-to-image to rasterize a 1080-wide DOM node (which would come out 2160x3840
 * and cost four times the canvas memory in a WebView for no visible gain).
 */
export const STORY_CARD_WIDTH = 540;
export const STORY_CARD_HEIGHT = 960;

/**
 * The captured node: fixed size, dark espresso gradient with the honey glow the season hero uses,
 * Barbets wordmark up top and `mybarbets.com` at the foot (the same reasoning as the reveal
 * ticket: this image leaves the app, and the marketing domain is the address meant to outlive
 * whatever deployment served it). Attach the share hook's `ref` here and never put a CSS
 * transform on this element itself: html-to-image copies the node's own computed styles into the
 * clone, so a scale applied here would scale the capture too. StoryCardPreview scales an ancestor
 * instead, which the clone never sees. The coin logo is a plain <img>, never next/image, same
 * rule as RevealTicket.
 */
export function StoryCardFrame({
  ref,
  eyebrow,
  children,
  className,
}: {
  ref?: Ref<HTMLDivElement>;
  /** The small honey caps line under the wordmark, e.g. the group name and a date. */
  eyebrow: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      ref={ref}
      style={{ width: STORY_CARD_WIDTH, height: STORY_CARD_HEIGHT }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden bg-gradient-to-br from-espresso-950 via-espresso-800 to-espresso-700 text-paper-white',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.7] [background:radial-gradient(circle_at_85%_6%,rgba(232,163,61,0.42),rgba(232,163,61,0)_58%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.45] [background:radial-gradient(circle_at_10%_96%,rgba(232,163,61,0.3),rgba(232,163,61,0)_50%)]" />

      <div className="relative flex flex-1 flex-col px-[52px] pt-[56px] pb-[48px]">
        <div className="flex items-center gap-[10px]">
          <img src="/barbets-mono-white.png" alt="" width={30} height={30} className="block" />
          <span className="text-[19px] font-extrabold tracking-[0.1em] text-honey-300 uppercase">Barbets</span>
        </div>
        <p className="mt-[18px] truncate text-[16px] font-bold tracking-[0.12em] text-honey-400 uppercase">{eyebrow}</p>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

        <div className="mt-[28px] flex items-center justify-between border-t border-white/10 pt-[22px]">
          <span className="text-[15px] font-extrabold tracking-[0.08em] text-paper-white/55 uppercase">Bet with friends</span>
          <span className="text-[15px] tracking-[0.03em] text-paper-white/40">mybarbets.com</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Fits a full-size StoryCardFrame into whatever box it is given, scaling a wrapper (not the frame)
 * so the capture stays 540x960 while the preview reads at phone size. Measured with a
 * ResizeObserver rather than CSS alone: `scale()` needs a unitless number and CSS has no way to
 * divide a length by a length to get one. Hidden with `opacity`, not `visibility`, until the
 * first measurement lands: visibility inherits, so html-to-image would copy `hidden` onto the
 * clone if a capture raced the first layout, and the PNG would come out blank.
 */
export function StoryCardPreview({ children, className }: { children: ReactNode; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const { width, height } = box.getBoundingClientRect();
      const next = Math.min(width / STORY_CARD_WIDTH, height / STORY_CARD_HEIGHT);
      setScale(Number.isFinite(next) && next > 0 ? next : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className={cn('flex min-h-0 min-w-0 flex-1 items-center justify-center', className)}>
      <div
        className="relative overflow-hidden rounded-[18px] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)]"
        style={{ width: STORY_CARD_WIDTH * scale, height: STORY_CARD_HEIGHT * scale, opacity: scale > 0 ? 1 : 0 }}
      >
        <div style={{ width: STORY_CARD_WIDTH, height: STORY_CARD_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The share/save button every story card offers, same label ladder as the reveal ticket's. */
export function ShareStoryButton({
  status,
  canShare,
  onClick,
  className,
}: {
  status: ShareableImageStatus;
  canShare: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={status === 'capturing' || status === 'working'}
      variant="accent"
      size="lg"
      className={cn('inline-flex items-center justify-center gap-2', className)}
    >
      {canShare ? <ShareIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
      {status === 'capturing' ? 'Preparing…' : status === 'working' ? 'Opening…' : status === 'failed' ? 'Try again' : canShare ? 'Share' : 'Save image'}
    </Button>
  );
}

/**
 * The full-screen dark stage a story card (or a deck of them) is previewed and shared from. Ported
 * to document.body and body-scroll-locked for the same reasons as Modal (a transformed ancestor
 * would capture `position: fixed`; a drag on the backdrop would otherwise scroll the page
 * underneath, and PullToRefresh only stands down while body overflow is hidden). Sits above
 * BottomNav at the same z the bet-confirmed overlay uses. Unlike Modal there is no "mounted"
 * guard before the portal: this is only ever opened from a click or a post-mount effect, never
 * during server render, and the guard would delay the card's node by one render, which is
 * exactly when useShareableImage() runs its eager capture and would find no node to capture.
 */
export function StoryOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-espresso-950 text-paper-white"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        paddingLeft: 'calc(env(safe-area-inset-left) + 20px)',
        paddingRight: 'calc(env(safe-area-inset-right) + 20px)',
      }}
    >
      <div className="flex h-11 shrink-0 items-center justify-between">
        <span className="text-[12px] font-extrabold tracking-[0.12em] text-honey-400 uppercase">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper-white transition-colors hover:bg-white/15 active:scale-[0.92]"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>,
    document.body
  );
}
