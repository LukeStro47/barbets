'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ShareStoryButton, StoryCardFrame, StoryCardPreview, StoryOverlay } from '@/components/share/StoryCard';
import { ChevronRightIcon } from '@/components/ui/icons';
import { Mention } from '@/components/ui/Mention';
import { useShareableImage } from '@/lib/shareImage';
import { STORY_CARDS_ENABLED } from '@/lib/flags';
import { logShareClick, type ShareClickContext } from '@/lib/actions/shareClicks';
import { formatOrdinal, formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import type { FinalBalanceRow } from '@/components/groups/SeasonRecapHero';

export interface WrappedHighlight {
  nickname: string;
  market_title: string | null;
  amount: number;
}

export interface SeasonWrappedProps {
  groupId: string;
  groupName: string;
  /** The season that just ended (season_results.season_id), which keys the once-only flag. */
  seasonId: string;
  seasonName: string;
  marketsSettled: number;
  /** season_results.snapshot.final_balances, already balance-descending. */
  finalBalances: FinalBalanceRow[];
  champion: FinalBalanceRow | null;
  loser: FinalBalanceRow | null;
  /** snapshot.biggest_single_win */
  biggestWin: WrappedHighlight | null;
  /** snapshot.worst_beat */
  worstCall: WrappedHighlight | null;
  /** snapshot.prize_text / punishment_text, frozen when the season closed. */
  prizeText: string | null;
  punishmentText: string | null;
  viewerUserId: string;
}

interface WrappedCard {
  key: string;
  context: ShareClickContext;
  title: string;
  filename: string;
  shareText: string;
  body: ReactNode;
}

const MEDAL = ['🥇', '🥈', '🥉'];
const STANDINGS_ROWS = 6;

/** Ordered by the final table, so a pair with the same gap higher up the table wins the tie. */
function closestFinishers(finalBalances: FinalBalanceRow[]): { a: FinalBalanceRow; b: FinalBalanceRow; rank: number; gap: number } | null {
  let best: { a: FinalBalanceRow; b: FinalBalanceRow; rank: number; gap: number } | null = null;
  for (let i = 0; i + 1 < finalBalances.length; i += 1) {
    const gap = finalBalances[i].balance - finalBalances[i + 1].balance;
    if (!best || gap < best.gap) best = { a: finalBalances[i], b: finalBalances[i + 1], rank: i + 1, gap };
  }
  return best;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[15px] font-bold tracking-[0.12em] text-honey-400 uppercase">{children}</p>;
}

function Headline({ children }: { children: ReactNode }) {
  return <p className="mt-[8px] text-[44px] leading-[1.05] font-extrabold tracking-[-0.025em]">{children}</p>;
}

function seenKey(seasonId: string) {
  return `wrapped-seen-${seasonId}`;
}

/**
 * One slide of the deck. Owns its own capture so each card is shared as its own PNG; the capture
 * waits until the slide has actually been swiped to (`ready`), so opening Wrapped costs one
 * rasterization, not five.
 */
function WrappedSlide({
  card,
  groupId,
  groupName,
  seasonName,
  ready,
}: {
  card: WrappedCard;
  groupId: string;
  groupName: string;
  seasonName: string;
  ready: boolean;
}) {
  const { ref, status, reason, canShare, share } = useShareableImage<HTMLDivElement>({
    filename: card.filename,
    title: `${groupName} · ${seasonName}`,
    text: card.shareText,
    ready,
  });

  const handleShareClick = () => {
    void logShareClick(card.context, groupId);
    share();
  };

  return (
    <div className="flex h-full w-full shrink-0 snap-center flex-col">
      <StoryCardPreview className="py-3">
        <StoryCardFrame ref={ref} eyebrow={`${groupName} · ${seasonName}`}>
          {card.body}
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
    </div>
  );
}

/**
 * The end-of-season card set, on the same renderer as the reveal ticket, the record card and the
 * called-it card. Every card reads straight off `season_results.snapshot` (the same blob the
 * recap hero, final table and highlights already render), so nothing here is recomputed live:
 *
 *   1. final standings      snapshot.final_balances
 *   2. biggest win          snapshot.biggest_single_win (the 20260907220000 rule, stake returns excluded)
 *   3. worst call           snapshot.worst_beat (the largest stake that paid 0 this season)
 *   4. rivalry              the two adjacent finishers in final_balances separated by the fewest
 *                           tokens. "The pair who bet against each other most" would need every
 *                           bet of the season, which the snapshot deliberately doesn't carry
 *   5. closing              snapshot.champion / loser with snapshot.prize_text / punishment_text,
 *                           the one and only card that names the season's stakes
 *
 * Cards 2 to 4 are skipped when the season has nothing to put on them (no win, no loss, one
 * member); 1 and 5 always render.
 *
 * Shown once: the overlay opens by itself the first time this device opens the group hub during
 * the intermission after `seasonId` ended, tracked in localStorage under `wrapped-seen-<seasonId>`
 * (the same per-device convention as RevealTicket's `mystery-torn-<marketId>`, and for the same
 * reason: the data is already on the client, so a second device or a cleared storage re-showing
 * it leaks nothing). The doc has no per-member "seen" table and this didn't earn one. The
 * "Wrapped" row under the hero reopens it any time, so it is never lost.
 */
export function SeasonWrapped(props: SeasonWrappedProps) {
  const { groupId, groupName, seasonId, seasonName, marketsSettled, finalBalances, champion, loser, biggestWin, worstCall, prizeText, punishmentText, viewerUserId } =
    props;
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const deckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const key = seenKey(seasonId);
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
      setOpen(true);
    } catch {
      // Storage unavailable (private mode, blocked site data): fall back to the button only.
    }
  }, [seasonId]);

  const rivalry = closestFinishers(finalBalances);
  const standings = finalBalances.slice(0, STANDINGS_ROWS);

  const cards: WrappedCard[] = [
    {
      key: 'standings',
      context: 'wrapped_standings',
      title: 'Final standings',
      filename: 'barbets-wrapped-standings.png',
      shareText: `${seasonName} at ${groupName}: the final standings.`,
      body: (
        <>
          <div className="mt-[26px]">
            <Eyebrow>Season complete</Eyebrow>
            <Headline>Final standings</Headline>
          </div>
          <ul className="mt-[30px] flex flex-col gap-[10px]">
            {standings.map((m, i) => (
              <li
                key={m.user_id}
                className={cn(
                  'flex h-[62px] items-center gap-[14px] rounded-[16px] bg-white/[0.07] px-[18px]',
                  m.user_id === viewerUserId && 'border-2 border-honey-500'
                )}
              >
                <span className="w-[34px] shrink-0 text-center text-[20px] font-extrabold text-paper-white/70">{MEDAL[i] ?? `${i + 1}.`}</span>
                <Mention nickname={m.nickname} className="min-w-0 flex-1 truncate text-[22px] font-bold" />
                <span className="shrink-0 text-[22px] font-extrabold text-honey-300">{formatTokens(m.balance)}</span>
              </li>
            ))}
          </ul>
          {finalBalances.length > STANDINGS_ROWS && (
            <p className="mt-[14px] text-[17px] text-paper-white/45">+{finalBalances.length - STANDINGS_ROWS} more at the table</p>
          )}
          <p className="mt-auto text-[17px] text-paper-white/55">
            {marketsSettled} market{marketsSettled === 1 ? '' : 's'} settled
          </p>
        </>
      ),
    },
  ];

  if (biggestWin) {
    cards.push({
      key: 'biggest_win',
      context: 'wrapped_biggest_win',
      title: 'Biggest win',
      filename: 'barbets-wrapped-biggest-win.png',
      shareText: `${seasonName} at ${groupName}: the biggest win.`,
      body: (
        <>
          <div className="mt-[26px]">
            <Eyebrow>Biggest win</Eyebrow>
            <Headline>
              <Mention nickname={biggestWin.nickname} />
            </Headline>
          </div>
          <p className="mt-[40px] text-[84px] leading-none font-extrabold tracking-[-0.03em] text-honey-300">+{formatTokens(biggestWin.amount)}</p>
          <p className="mt-[10px] text-[17px] font-bold tracking-[0.08em] text-paper-white/55 uppercase">tokens on one call</p>
          <p className="mt-[36px] line-clamp-4 text-[28px] leading-[1.25] font-bold text-paper-white/85">
            &ldquo;{biggestWin.market_title ?? 'a settled market'}&rdquo;
          </p>
        </>
      ),
    });
  }

  if (worstCall) {
    cards.push({
      key: 'worst_call',
      context: 'wrapped_worst_call',
      title: 'Worst call',
      filename: 'barbets-wrapped-worst-call.png',
      shareText: `${seasonName} at ${groupName}: the worst call.`,
      body: (
        <>
          <div className="mt-[26px]">
            <Eyebrow>Worst call</Eyebrow>
            <Headline>
              <Mention nickname={worstCall.nickname} />
            </Headline>
          </div>
          <p className="mt-[40px] text-[84px] leading-none font-extrabold tracking-[-0.03em] text-paper-white/90">&minus;{formatTokens(worstCall.amount)}</p>
          <p className="mt-[10px] text-[17px] font-bold tracking-[0.08em] text-paper-white/55 uppercase">tokens, gone in one bet</p>
          <p className="mt-[36px] line-clamp-4 text-[28px] leading-[1.25] font-bold text-paper-white/85">
            &ldquo;{worstCall.market_title ?? 'a settled market'}&rdquo;
          </p>
        </>
      ),
    });
  }

  if (rivalry) {
    cards.push({
      key: 'rivalry',
      context: 'wrapped_rivalry',
      title: 'Rivalry of the season',
      filename: 'barbets-wrapped-rivalry.png',
      shareText: `${seasonName} at ${groupName}: the rivalry of the season.`,
      body: (
        <>
          <div className="mt-[26px]">
            <Eyebrow>Rivalry of the season</Eyebrow>
            <Headline>Too close to call</Headline>
          </div>
          <div className="mt-[40px] flex flex-col gap-[16px]">
            {[rivalry.a, rivalry.b].map((m, i) => (
              <div key={m.user_id} className="rounded-[20px] bg-white/[0.07] px-[24px] py-[20px]">
                <p className="text-[15px] font-bold tracking-[0.1em] text-paper-white/45 uppercase">{formatOrdinal(rivalry.rank + i)} place</p>
                <Mention nickname={m.nickname} className="mt-[4px] block truncate text-[34px] leading-[1.15] font-extrabold" />
                <p className="mt-[4px] text-[22px] font-extrabold text-honey-300">{formatTokens(m.balance)}</p>
              </div>
            ))}
          </div>
          <p className="mt-[30px] text-[24px] leading-[1.3] font-bold text-paper-white/80">
            {rivalry.gap === 0 ? 'Dead level at the finish.' : `Separated by ${formatTokens(rivalry.gap)} token${rivalry.gap === 1 ? '' : 's'} at the finish.`}
          </p>
        </>
      ),
    });
  }

  cards.push({
    key: 'closing',
    context: 'wrapped_closing',
    title: "That's a wrap",
    filename: 'barbets-wrapped-closing.png',
    shareText: `${seasonName} at ${groupName} is a wrap.`,
    body: (
      <>
        <div className="mt-[26px]">
          <Eyebrow>{seasonName}</Eyebrow>
          <Headline>That&rsquo;s a wrap</Headline>
        </div>
        <div className="mt-[36px] flex flex-col gap-[16px]">
          {champion && (
            <div className="rounded-[22px] bg-honey-500 px-[24px] py-[22px] text-espresso-950">
              <p className="text-[15px] font-extrabold tracking-[0.1em] uppercase">🏆 Champion</p>
              <Mention nickname={champion.nickname} className="mt-[4px] block truncate text-[36px] leading-[1.15] font-extrabold" />
              {prizeText && <p className="mt-[10px] line-clamp-3 text-[21px] leading-[1.3] font-bold">Gets: {prizeText}</p>}
            </div>
          )}
          {loser && loser.user_id !== champion?.user_id && (
            <div className="rounded-[22px] bg-white/[0.08] px-[24px] py-[22px]">
              <p className="text-[15px] font-extrabold tracking-[0.1em] text-paper-white/55 uppercase">💀 Last place</p>
              <Mention nickname={loser.nickname} className="mt-[4px] block truncate text-[36px] leading-[1.15] font-extrabold" />
              {punishmentText && <p className="mt-[10px] line-clamp-3 text-[21px] leading-[1.3] font-bold text-paper-white/85">Owes: {punishmentText}</p>}
            </div>
          )}
        </div>
        <p className="mt-auto text-[17px] text-paper-white/55">
          {finalBalances.length} at the table · {marketsSettled} market{marketsSettled === 1 ? '' : 's'}
        </p>
      </>
    ),
  });

  const onDeckScroll = () => {
    const deck = deckRef.current;
    if (!deck || deck.clientWidth === 0) return;
    const next = Math.round(deck.scrollLeft / deck.clientWidth);
    if (next !== index) {
      setIndex(next);
      setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    }
  };

  const close = () => {
    setOpen(false);
    setIndex(0);
    setVisited(new Set([0]));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 rounded-[18px] border border-espresso-100 bg-paper-white px-4 py-3 text-left transition-colors hover:bg-espresso-50/40 active:scale-[0.99]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-honey-50 text-[16px]">✦</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-espresso-950">Season Wrapped</span>
          <span className="block text-[11.5px] text-espresso-400">
            {cards.length} cards to swipe and share
          </span>
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-espresso-300" />
      </button>

      {open && (
        <StoryOverlay title={cards[index]?.title ?? 'Wrapped'} onClose={close}>
          <div
            ref={deckRef}
            onScroll={onDeckScroll}
            className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {cards.map((card, i) => (
              <WrappedSlide key={card.key} card={card} groupId={groupId} groupName={groupName} seasonName={seasonName} ready={visited.has(i)} />
            ))}
          </div>
          <div className="mt-3 flex shrink-0 items-center justify-center gap-1.5" aria-hidden>
            {cards.map((card, i) => (
              <span key={card.key} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-honey-500' : 'w-1.5 bg-white/25')} />
            ))}
          </div>
          <p className="mt-2 shrink-0 text-center text-[11.5px] text-paper-white/40">
            {index + 1} of {cards.length} · swipe
          </p>
        </StoryOverlay>
      )}
    </>
  );
}
