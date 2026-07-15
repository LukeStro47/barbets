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
  /** Reaction -> nicknames of everyone who picked it, for the breakdown popover. */
  nicknames: Partial<Record<ReactionEmoji, string[]>>;
  myNickname: string;
}

/**
 * Corner facepile on the reveal ticket: one overlapping circle per reaction
 * that's actually been used, stacked like an avatar pile. Tapping it opens a
 * popover with the 6-emoji picker up top and a per-reaction "who picked
 * what" breakdown below.
 *
 * z-index stays below the sticky header's (z-10) on purpose — this used to
 * be z-20, which meant that once the ticket scrolled up far enough for the
 * pill to cross behind the header, it rendered in front of the header
 * instead of correctly disappearing behind it.
 */
export function ReactionBar({ groupId, marketId, counts, myReaction, nicknames, myNickname }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mine, setMine] = useState(myReaction);
  const [localCounts, setLocalCounts] = useState(counts);
  const [localNicknames, setLocalNicknames] = useState(nicknames);
  const [open, setOpen] = useState(false);

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
    setLocalNicknames((n) => {
      const updated = { ...n };
      if (previous) updated[previous] = (updated[previous] ?? []).filter((name) => name !== myNickname);
      if (next) updated[next] = [...(updated[next] ?? []), myNickname];
      return updated;
    });

    startTransition(async () => {
      const result = await reactToMarket(groupId, marketId, emoji);
      if (result.error) {
        setError(result.error);
        setMine(previous);
        setLocalCounts(counts);
        setLocalNicknames(nicknames);
      } else {
        router.refresh();
      }
    });
  }

  const active = REACTIONS.filter((r) => (localCounts[r.emoji] ?? 0) > 0);

  return (
    <div className="absolute top-5 right-5 z-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        aria-label="Reactions"
        className="flex items-center rounded-full bg-black/30 py-1 pr-1 pl-2.5 ring-1 ring-white/15 backdrop-blur"
      >
        {active.length === 0 ? (
          <span className="text-lg leading-none text-paper-white">+</span>
        ) : (
          <span className="flex items-center">
            {active.map((r, i) => (
              <span
                key={r.emoji}
                className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-espresso-800 text-base ring-2 ring-espresso-900 first:ml-0"
                style={{ zIndex: active.length - i }}
              >
                {r.glyph}
              </span>
            ))}
            <span className="ml-1.5 mr-0.5 text-base leading-none text-paper-white/70">+</span>
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-outside-to-close backdrop, purely for dismissal — not part of the ticket's own visual design. */}
          <button type="button" aria-label="Close reaction picker" onClick={() => setOpen(false)} className="fixed inset-0 z-0 cursor-default" />
          <div className="absolute top-full right-0 z-[1] mt-2 w-56 space-y-2 rounded-2xl bg-paper-white p-2.5 shadow-lg ring-1 ring-espresso-200/60">
            <div className="flex items-center justify-between">
              {REACTIONS.map(({ emoji, glyph }) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={isPending}
                  onClick={() => tap(emoji)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xl ${
                    mine === emoji ? 'bg-honey-100 ring-2 ring-honey-400' : 'hover:bg-espresso-50'
                  }`}
                >
                  {glyph}
                </button>
              ))}
            </div>

            {active.length > 0 && (
              <div className="space-y-1 border-t border-espresso-100 pt-2">
                {active.map((r) => (
                  <div key={r.emoji} className="flex items-center gap-2 text-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">{r.glyph}</span>
                    <span className="truncate text-espresso-600">
                      {(localNicknames[r.emoji] ?? []).map((n) => `@${n}`).join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {error && <p className="absolute top-full right-0 z-0 mt-2 w-40 text-right text-[11px] text-danger-300">{error}</p>}
    </div>
  );
}
