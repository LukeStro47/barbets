'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reactToMarket, type ReactionEmoji } from '@/lib/actions/reactions';
import { REACTIONS } from '@/lib/reactions';

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
 * A light, full-width footer row on the reveal screen: a chip per reaction
 * that's actually been used, plus a trailing "+" affordance. Tapping
 * anywhere on the row opens a popover with the 6-emoji picker up top and a
 * per-reaction "who picked what" breakdown below.
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
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        aria-label="Reactions"
        className="flex w-full items-center gap-2 rounded-[16px] border border-hairline bg-surface px-3.5 py-3"
      >
        {active.length === 0 ? (
          <span className="text-[13px] font-semibold text-faint">React to this result</span>
        ) : (
          active.map((r) => (
            <span
              key={r.emoji}
              className={
                mine === r.emoji
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-[#d9e1ff] bg-signal-tint px-2.5 py-1.5 text-[13px]'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-rule px-2.5 py-1.5 text-[13px]'
              }
            >
              <span>{r.glyph}</span>
              <span className={mine === r.emoji ? 'font-mono text-[11px] font-semibold text-signal-deep' : 'font-mono text-[11px] font-semibold text-faint'}>
                {localCounts[r.emoji]}
              </span>
            </span>
          ))
        )}
        <span className="ml-auto flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-[13px] text-faint">
          +
        </span>
      </button>

      {open && (
        <>
          {/* Click-outside-to-close backdrop, purely for dismissal — not part of the row's own visual design. */}
          <button type="button" aria-label="Close reaction picker" onClick={() => setOpen(false)} className="fixed inset-0 z-0 cursor-default" />
          <div className="absolute top-full right-0 z-[1] mt-2 w-56 space-y-2 rounded-2xl bg-surface p-2.5 ring-1 ring-dash/60">
            <div className="flex items-center justify-between">
              {REACTIONS.map(({ emoji, glyph }) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={isPending}
                  onClick={() => tap(emoji)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xl ${
                    mine === emoji ? 'bg-signal-tint ring-2 ring-signal' : 'hover:bg-rule'
                  }`}
                >
                  {glyph}
                </button>
              ))}
            </div>

            {active.length > 0 && (
              <div className="space-y-1 border-t border-hairline pt-2">
                {active.map((r) => (
                  <div key={r.emoji} className="flex items-center gap-2 text-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">{r.glyph}</span>
                    <span className="truncate text-muted">
                      {(localNicknames[r.emoji] ?? []).map((n) => `@${n}`).join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {error && <p className="absolute top-full right-0 z-0 mt-2 w-40 text-right text-[11px] text-alert">{error}</p>}
    </div>
  );
}
