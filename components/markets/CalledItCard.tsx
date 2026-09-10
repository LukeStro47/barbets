'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ImageIcon } from '@/components/ui/icons';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { Mention } from '@/components/ui/Mention';
import { ShareStoryButton, StoryCardFrame, StoryCardPreview, StoryOverlay } from '@/components/share/StoryCard';
import { useShareableImage } from '@/lib/shareImage';
import { STORY_CARDS_ENABLED } from '@/lib/flags';
import { logShareClick } from '@/lib/actions/shareClicks';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

export interface CalledItWinner {
  nickname: string;
  amount: number;
  payout: number;
}

export interface CalledItCardProps {
  groupId: string;
  groupName: string;
  question: string;
  /** The winning side in caps or the winning option's raw label (an "@nickname" for most_likely_to), same as the reveal ticket's headline. */
  outcomeLabel: string;
  resolvedAtIso: string;
  /** Every winning bet, best payout first. */
  winners: CalledItWinner[];
  /** Distinct nicknames with no winning bet on the market. */
  losers: string[];
  viewerNickname: string;
}

const MAX_NAMES = 5;

/** A payout equal to the stake is a one-sided market's refund, not a win worth quoting (see the
 * design note on "+0 won"). The card quotes the viewer's own winnings when they won, otherwise
 * the biggest win on the market, and nothing at all when neither is a real win. */
function pickChips(winners: CalledItWinner[], viewerNickname: string): { amount: number; nickname: string; mine: boolean } | null {
  const mine = winners.find((w) => w.nickname === viewerNickname && w.payout > w.amount);
  if (mine) return { amount: mine.payout, nickname: mine.nickname, mine: true };
  const biggest = winners.find((w) => w.payout > w.amount);
  return biggest ? { amount: biggest.payout, nickname: biggest.nickname, mine: false } : null;
}

function NameList({ names, tone }: { names: string[]; tone: 'winner' | 'loser' }) {
  const shown = names.slice(0, MAX_NAMES);
  const extra = names.length - shown.length;
  return (
    <ul className="mt-[8px] flex flex-col gap-[4px]">
      {shown.map((n) => (
        <li key={n} className="truncate">
          <Mention nickname={n} className={cn('text-[20px] leading-[1.3] font-bold', tone === 'winner' ? 'text-paper-white' : 'text-paper-white/55')} />
        </li>
      ))}
      {extra > 0 && <li className="text-[16px] leading-[1.3] text-paper-white/45">+{extra} more</li>}
    </ul>
  );
}

/**
 * The third shareable image, after the reveal ticket and the record card: a story-sized "called
 * it" card for a resolved market. Offered as a button beside the ticket's own share control on
 * the reveal page, which is exactly where the existing resolution push already lands, so no
 * new push is needed to "offer" it. Only ever rendered for a resolved (not voided, never
 * unresolved) market, and a subject reaches this page only after resolution, when the market is
 * theirs to see. Carries no prize or punishment by design: those belong to the season, and they
 * appear only on Wrapped's closing card.
 *
 * The card is previewed in a full-screen overlay rather than inline: it is 9:16 and would dwarf
 * the ticket, and previewing it is what lets someone see the exact image before the share sheet
 * opens. Capture starts when the overlay opens (`ready`), not on mount, so the reveal page never
 * pays for a PNG nobody asked for.
 */
export function CalledItCard({ groupId, groupName, question, outcomeLabel, resolvedAtIso, winners, losers, viewerNickname }: CalledItCardProps) {
  const [open, setOpen] = useState(false);
  const { ref, status, reason, canShare, share } = useShareableImage<HTMLDivElement>({
    filename: 'barbets-called-it.png',
    title: `${groupName} · ${question}`,
    text: `"${question}" resolved: ${outcomeLabel}.`,
    ready: open,
  });

  const handleShareClick = () => {
    void logShareClick('called_it_card', groupId);
    share();
  };

  const chips = pickChips(winners, viewerNickname);
  const winnerNames = Array.from(new Set(winners.map((w) => w.nickname)));
  const formattedDate = new Date(resolvedAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const viewerCalledIt = winnerNames.includes(viewerNickname);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="outline"
        className="inline-flex flex-1 items-center justify-center gap-2"
      >
        <ImageIcon className="h-4 w-4" />
        Story card
      </Button>

      {open && (
        <StoryOverlay title="Called it" onClose={() => setOpen(false)}>
          <StoryCardPreview className="py-3">
            <StoryCardFrame ref={ref} eyebrow={`${groupName} · Resolved ${formattedDate}`}>
              <p className="mt-[22px] inline-flex w-fit -rotate-2 rounded-[14px] bg-honey-500 px-[16px] py-[8px] text-[17px] font-extrabold tracking-[0.12em] text-espresso-950 uppercase">
                {winnerNames.length === 0 ? 'Nobody called it' : viewerCalledIt ? 'Called it' : 'Somebody called it'}
              </p>
              <p className="mt-[20px] line-clamp-4 text-balance text-[36px] leading-[1.1] font-extrabold tracking-[-0.02em]">{question}</p>

              <p className="mt-[26px] text-[15px] font-bold tracking-[0.12em] text-honey-400 uppercase">The call</p>
              <p className="mt-[6px] line-clamp-2 text-[30px] leading-[1.15] font-extrabold text-honey-300 uppercase">
                <OptionLabel label={outcomeLabel} className="text-honey-300" />
              </p>

              <div className="mt-[26px] flex gap-[28px]">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold tracking-[0.12em] text-honey-400 uppercase">Called it</p>
                  {winnerNames.length > 0 ? (
                    <NameList names={winnerNames} tone="winner" />
                  ) : (
                    <p className="mt-[8px] text-[18px] text-paper-white/55">Not one of them.</p>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold tracking-[0.12em] text-paper-white/45 uppercase">Missed it</p>
                  {losers.length > 0 ? (
                    <NameList names={losers} tone="loser" />
                  ) : (
                    <p className="mt-[8px] text-[18px] text-paper-white/55">Nobody.</p>
                  )}
                </div>
              </div>

              {chips && (
                <div className="mt-auto flex items-end justify-between gap-[16px] rounded-[22px] bg-white/[0.07] px-[24px] pt-[18px] pb-[20px]">
                  <p className="text-[52px] leading-none font-extrabold tracking-[-0.03em] text-honey-300">+{formatTokens(chips.amount)}</p>
                  <p className="pb-[4px] text-right text-[15px] leading-[1.3] font-bold tracking-[0.06em] text-paper-white/60 uppercase">
                    {chips.mine ? (
                      <>
                        tokens
                        <br />
                        my winnings
                      </>
                    ) : (
                      <>
                        tokens
                        <br />
                        biggest win, <Mention nickname={chips.nickname} />
                      </>
                    )}
                  </p>
                </div>
              )}
            </StoryCardFrame>
          </StoryCardPreview>

          <div className="mt-2 flex shrink-0 flex-col items-center gap-2">
            {STORY_CARDS_ENABLED ? (
              <ShareStoryButton status={status} canShare={canShare} onClick={handleShareClick} className="w-full max-w-sm" />
            ) : (
              <p className="text-center text-[12.5px] text-paper-white/50">Sharing is switched off for now.</p>
            )}
            {STORY_CARDS_ENABLED && status === 'failed' && reason && <p className="text-center text-[11.5px] text-paper-white/60">{reason}</p>}
          </div>
        </StoryOverlay>
      )}
    </>
  );
}
