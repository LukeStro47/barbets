'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteComment, reactToComment, revealBetOnComment } from '@/lib/actions/comments';
import { REACTIONS, type ReactionEmoji } from '@/lib/reactions';
import { formatTokens } from '@/lib/formatNumber';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { cn } from '@/lib/cn';

export interface CommentRowData {
  id: string;
  userId: string;
  nickname: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
  body: string;
  createdAt: string;
  isMine: boolean;
  /** Present only when this comment carries the author's revealed bet. */
  revealedLabel: string | null;
  revealedAmount: number | null;
  counts: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
}

/**
 * One comment (4e): a 32px avatar, @name (with "you" on your own and a "revealed N on X" tag on
 * a comment that carries a bet), a mono time, the body, then reaction chips and a + to add one.
 * Your own latest un-revealed comment gets the "Show the group your bet" card underneath.
 */
export function CommentRow({
  groupId,
  marketId,
  comment,
  revealable,
}: {
  groupId: string;
  marketId: string;
  comment: CommentRowData;
  revealable?: { label: string; amount: number } | null;
}) {
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
      if (result.error) setError(result.error);
      else {
        setDeleted(true);
        router.refresh();
      }
    });
  }

  function reveal() {
    setError(null);
    startTransition(async () => {
      const result = await revealBetOnComment(groupId, marketId, comment.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  if (deleted) return null;

  const activeReactions = REACTIONS.filter((r) => (counts[r.emoji] ?? 0) > 0);

  return (
    <div className="flex gap-2.5">
      <UserAvatar
        userId={comment.userId}
        nickname={comment.nickname}
        avatarUpdatedAt={comment.avatarUpdatedAt}
        avatarPresetKey={comment.avatarPresetKey}
        className="h-8 w-8 text-[11px]"
        fallbackClassName="bg-tile text-muted"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-bold text-ink">@{comment.nickname}</span>
          {comment.isMine && <span className="text-[11px] font-semibold text-signal">you</span>}
          {comment.revealedLabel && comment.revealedAmount != null && (
            <span className="inline-flex items-center rounded-md border border-signal-line bg-signal-wash px-[7px] py-0.5 font-mono text-[10.5px] font-semibold text-signal">
              revealed {formatTokens(comment.revealedAmount)} on {comment.revealedLabel}
            </span>
          )}
          <span className="font-mono text-[11px] text-faint">{formatRelativeTime(comment.createdAt).replace(' ago', '')}</span>
        </div>

        <p className="mt-[3px] text-[13.5px] leading-[1.5] text-ink text-pretty">{comment.body}</p>

        {revealable && (
          <div className="mt-2 flex items-center gap-[9px] rounded-xl border border-signal-line bg-signal-wash px-[11px] py-[9px]">
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-bold text-signal">Show the group your bet</span>
              <span className="mt-px block font-mono text-[11px] text-faint">
                {formatTokens(revealable.amount)} on {revealable.label}. You can&apos;t take it back.
              </span>
            </span>
            <button
              type="button"
              onClick={reveal}
              disabled={isPending}
              className="shrink-0 rounded-[9px] bg-signal px-[11px] py-[7px] text-[11.5px] font-bold text-surface disabled:opacity-50"
            >
              Reveal
            </button>
          </div>
        )}

        <div className="mt-[7px] flex items-center gap-[7px]">
          {activeReactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              disabled={isPending}
              onClick={() => tapEmoji(r.emoji)}
              className={cn(
                'inline-flex items-center gap-[5px] rounded-full border px-[9px] py-[3px] text-[13px]',
                mine === r.emoji ? 'border-signal-edge bg-signal-tint' : 'border-hairline bg-surface'
              )}
            >
              {r.glyph}
              <span className={cn('font-mono text-[11.5px]', mine === r.emoji ? 'font-bold text-signal' : 'font-semibold text-faint')}>{counts[r.emoji]}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="React"
            className="flex h-[23px] w-[23px] items-center justify-center rounded-full border border-hairline bg-surface text-faint"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </button>
          {comment.isMine && (
            <button type="button" onClick={remove} disabled={isPending} className="ml-auto text-[11.5px] font-semibold text-faint">
              Delete
            </button>
          )}
        </div>

        {pickerOpen && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-surface p-1">
            {REACTIONS.map(({ emoji, glyph }) => (
              <button
                key={emoji}
                type="button"
                disabled={isPending}
                onClick={() => tapEmoji(emoji)}
                className={cn('flex h-7 w-7 items-center justify-center rounded-full text-base', mine === emoji ? 'bg-signal-tint' : 'hover:bg-tile')}
              >
                {glyph}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-1 text-[11px] text-alert">{error}</p>}
      </div>
    </div>
  );
}
