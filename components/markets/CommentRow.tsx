'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteComment, reactToComment } from '@/lib/actions/comments';
import { REACTIONS, type ReactionEmoji } from '@/lib/reactions';
import { formatTokens } from '@/lib/formatNumber';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { Mention } from '@/components/ui/Mention';
import { cn } from '@/lib/cn';

export interface CommentRowData {
  id: string;
  nickname: string;
  body: string;
  createdAt: string;
  isMine: boolean;
  /** Present only when this comment revealed the author's own bet. */
  revealedLabel: string | null;
  revealedAmount: number | null;
  counts: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
}

export function CommentRow({ groupId, marketId, comment }: { groupId: string; marketId: string; comment: CommentRowData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mine, setMine] = useState(comment.myReaction);
  const [counts, setCounts] = useState(comment.counts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function tapEmoji(emoji: ReactionEmoji) {
    setError(null);
    const previous = mine;
    const next = previous === emoji ? null : emoji;
    setMine(next);
    setCounts((c) => {
      const updated = { ...c };
      if (previous) updated[previous] = Math.max(0, (updated[previous] ?? 0) - 1);
      if (next) updated[next] = (updated[next] ?? 0) + 1;
      return updated;
    });
    setPickerOpen(false);

    startTransition(async () => {
      const result = await reactToComment(groupId, marketId, comment.id, emoji);
      if (result.error) {
        setError(result.error);
        setMine(previous);
        setCounts(comment.counts);
      } else {
        router.refresh();
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteComment(groupId, marketId, comment.id);
      if (result.error) {
        setError(result.error);
      } else {
        setDeleted(true);
        router.refresh();
      }
    });
  }

  if (deleted) return null;

  const activeReactions = REACTIONS.filter((r) => (counts[r.emoji] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-bold text-ink">
          <Mention nickname={comment.nickname} />
        </span>
        <span className="font-mono text-[11px] text-faint">{formatRelativeTime(comment.createdAt).replace(' ago', '')}</span>
      </div>

      <p className="text-[13.5px] leading-[1.5] text-ink text-pretty">{comment.body}</p>

      {comment.revealedLabel && comment.revealedAmount != null && (
        <div className="flex items-center gap-2 rounded-[12px] border border-signal/30 bg-signal-tint px-3 py-2">
          <span className="text-[12px] font-bold text-signal-deep">Revealed:</span>
          <span className="font-mono text-[12px] font-semibold text-ink">
            {formatTokens(comment.revealedAmount)} on {comment.revealedLabel}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {activeReactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            disabled={isPending}
            onClick={() => tapEmoji(r.emoji)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold',
              mine === r.emoji ? 'border-signal bg-signal-tint text-signal-deep' : 'border-hairline bg-surface text-muted'
            )}
          >
            <span>{r.glyph}</span>
            <span className="font-mono">{counts[r.emoji]}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-hairline text-[13px] text-faint"
          aria-label="React"
        >
          +
        </button>

        {comment.isMine && (
          <button type="button" onClick={remove} disabled={isPending} className="ml-auto text-[11.5px] font-semibold text-faint">
            Delete
          </button>
        )}
      </div>

      {pickerOpen && (
        <div className="flex items-center gap-1 rounded-full border border-hairline bg-surface p-1">
          {REACTIONS.map(({ emoji, glyph }) => (
            <button
              key={emoji}
              type="button"
              disabled={isPending}
              onClick={() => tapEmoji(emoji)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-base',
                mine === emoji ? 'bg-signal-tint' : 'hover:bg-rule'
              )}
            >
              {glyph}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-alert">{error}</p>}
    </div>
  );
}
