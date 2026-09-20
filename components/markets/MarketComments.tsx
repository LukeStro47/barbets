'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  deleteMarketComment,
  postMarketComment,
  type MarketComment,
} from '@/lib/actions/comments';
import { MARKET_COMMENT_MAX_LENGTH } from '@/lib/limits';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Market banter thread (DESIGN 4e). Top-level comments plus one level of replies.
 * Soft-deleted rows stay for threading and render as "Deleted".
 */
export function MarketComments({
  groupId,
  marketId,
  currentUserId,
  initialComments,
}: {
  groupId: string;
  marketId: string;
  currentUserId: string;
  initialComments: MarketComment[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tops = initialComments.filter((c) => !c.parent_id);
  const repliesByParent = new Map<string, MarketComment[]>();
  for (const c of initialComments) {
    if (!c.parent_id) continue;
    const list = repliesByParent.get(c.parent_id) ?? [];
    list.push(c);
    repliesByParent.set(c.parent_id, list);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await postMarketComment(groupId, marketId, body, replyTo);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody('');
      setReplyTo(null);
      router.refresh();
    });
  }

  function remove(commentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteMarketComment(groupId, marketId, commentId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-[13px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Comments</h2>
        <span className="font-mono text-[12.5px] font-semibold text-faint">
          {initialComments.filter((c) => !c.deleted_at).length}
        </span>
      </div>

      <ul className="space-y-[9px]">
        {tops.length === 0 && (
          <li className="rounded-[20px] border border-hairline bg-surface px-4 py-5 text-center text-[12.5px] text-muted">
            No comments yet. Say something.
          </li>
        )}
        {tops.map((c) => (
          <li key={c.id} className="space-y-[9px]">
            <CommentRow
              comment={c}
              currentUserId={currentUserId}
              onReply={() => setReplyTo(c.id)}
              onDelete={() => remove(c.id)}
              disabled={isPending}
            />
            {(repliesByParent.get(c.id) ?? []).map((r) => (
              <div key={r.id} className="pl-4">
                <CommentRow
                  comment={r}
                  currentUserId={currentUserId}
                  onDelete={() => remove(r.id)}
                  disabled={isPending}
                />
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div className="rounded-[20px] border border-hairline bg-surface p-3.5">
        {replyTo && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11.5px] text-faint">Replying</p>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="text-[11.5px] font-bold text-signal"
            >
              Cancel
            </button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MARKET_COMMENT_MAX_LENGTH))}
          rows={3}
          placeholder="Add a comment"
          className="w-full resize-none rounded-[14px] border border-hairline bg-canvas px-3.5 py-3 text-[13.5px] text-ink placeholder:text-faint focus:border-signal focus:outline-none focus:ring-4 focus:ring-signal/15"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span
            className={cn(
              'font-mono text-[11.5px] text-faint',
              body.length >= MARKET_COMMENT_MAX_LENGTH - 20 && 'text-muted'
            )}
          >
            {body.length}/{MARKET_COMMENT_MAX_LENGTH}
          </span>
          <Button type="button" size="sm" disabled={isPending || !body.trim()} onClick={submit}>
            Post
          </Button>
        </div>
        {error && <p className="mt-2 text-[12px] text-alert">{error}</p>}
      </div>
    </section>
  );
}

function CommentRow({
  comment,
  currentUserId,
  onReply,
  onDelete,
  disabled,
}: {
  comment: MarketComment;
  currentUserId: string;
  onReply?: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const deleted = !!comment.deleted_at;
  const mine = comment.author_id === currentUserId;

  return (
    <div className="rounded-[20px] border border-hairline bg-surface px-4 py-[14px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] font-bold text-ink">
          {deleted ? 'Deleted' : comment.author_nickname ? `@${comment.author_nickname}` : 'Former member'}
        </p>
        <p className="font-mono text-[11.5px] text-faint">
          {new Date(comment.created_at).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
      </div>
      <p className={cn('mt-1.5 text-[13.5px] leading-[1.5]', deleted ? 'text-faint italic' : 'text-muted')}>
        {deleted ? 'This comment was deleted.' : comment.body}
      </p>
      {!deleted && (
        <div className="mt-2 flex gap-3">
          {onReply && (
            <button
              type="button"
              disabled={disabled}
              onClick={onReply}
              className="text-[11.5px] font-bold text-signal disabled:opacity-50"
            >
              Reply
            </button>
          )}
          {mine && (
            <button
              type="button"
              disabled={disabled}
              onClick={onDelete}
              className="text-[11.5px] font-bold text-alert disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
