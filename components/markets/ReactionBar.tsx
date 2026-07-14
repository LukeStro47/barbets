'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reactToMarket, type ReactionEmoji } from '@/lib/actions/reactions';

const REACTIONS: { emoji: ReactionEmoji; glyph: string }[] = [
  { emoji: 'fire', glyph: '🔥' },
  { emoji: 'laugh', glyph: '😂' },
  { emoji: 'clown', glyph: '🤡' },
  { emoji: 'salute', glyph: '🫡' },
  { emoji: 'thumbs_up', glyph: '👍' },
  { emoji: 'thumbs_down', glyph: '👎' },
];

interface Props {
  groupId: string;
  marketId: string;
  /** Reaction -> count, sparse (only reactions with at least one vote are present). */
  counts: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
}

/** Corner pill on the reveal ticket: shows whichever reactions already have votes, plus a "+" that opens a popover with all six choices. */
export function ReactionBar({ groupId, marketId, counts, myReaction }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mine, setMine] = useState(myReaction);
  const [localCounts, setLocalCounts] = useState(counts);
  const [open, setOpen] = useState(false);

  function tap(emoji: ReactionEmoji) {
    setError(null);
    setOpen(false);
    const previous = mine;
    const next = previous === emoji ? null : emoji;

    // Optimistic update, reconciled by router.refresh() below.
    setMine(next);
    setLocalCounts((c) => {
      const updated = { ...c };
      if (previous) updated[previous] = Math.max(0, (updated[previous] ?? 0) - 1);
      if (next) updated[next] = (updated[next] ?? 0) + 1;
      return updated;
    });

    startTransition(async () => {
      const result = await reactToMarket(groupId, marketId, emoji);
      if (result.error) {
        setError(result.error);
        setMine(previous);
        setLocalCounts(counts);
      } else {
        router.refresh();
      }
    });
  }

  const active = REACTIONS.filter((r) => (localCounts[r.emoji] ?? 0) > 0);

  return (
    <div className="absolute top-5 right-5 z-20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5 text-[15px] font-bold text-paper-white ring-1 ring-white/15 backdrop-blur"
      >
        {active.map((r) => (
          <span key={r.emoji} className="flex items-center gap-1">
            <span className="text-lg">{r.glyph}</span>
            <span className="text-[12.5px] text-paper-white/80">{localCounts[r.emoji]}</span>
          </span>
        ))}
        <span className="text-lg leading-none">+</span>
      </button>

      {open && (
        <>
          {/* Click-outside-to-close backdrop, purely for dismissal — not part of the ticket's own visual design. */}
          <button type="button" aria-label="Close reaction picker" onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          <div className="absolute top-full right-0 z-20 mt-2 flex gap-1 rounded-2xl bg-paper-white p-1.5 shadow-lg ring-1 ring-espresso-200/60">
            {REACTIONS.map(({ emoji, glyph }) => (
              <button
                key={emoji}
                type="button"
                disabled={isPending}
                onClick={() => tap(emoji)}
                className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl ${
                  mine === emoji ? 'bg-honey-100 ring-2 ring-honey-400' : 'hover:bg-espresso-50'
                }`}
              >
                {glyph}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="absolute top-full right-0 z-20 mt-2 w-40 text-right text-[11px] text-danger-300">{error}</p>}
    </div>
  );
}
