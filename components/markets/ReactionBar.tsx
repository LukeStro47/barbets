'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reactToMarket, type ReactionEmoji } from '@/lib/actions/reactions';
import { Card } from '@/components/ui/Card';

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

export function ReactionBar({ groupId, marketId, counts, myReaction }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mine, setMine] = useState(myReaction);
  const [localCounts, setLocalCounts] = useState(counts);

  function tap(emoji: ReactionEmoji) {
    setError(null);
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

  return (
    <Card className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {REACTIONS.map(({ emoji, glyph }) => {
          const count = localCounts[emoji] ?? 0;
          const active = mine === emoji;
          return (
            <button
              key={emoji}
              type="button"
              disabled={isPending}
              onClick={() => tap(emoji)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                active ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
              }`}
            >
              <span>{glyph}</span>
              {count > 0 && <span>{count}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
