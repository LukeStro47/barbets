'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addMarketComment, deleteMarketComment, markMarketCommentsRead } from '@/lib/actions/comments';
import { reportMarketComment } from '@/lib/actions/feedback';
import { MARKET_COMMENT_MAX_LENGTH } from '@/lib/limits';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Mention } from '@/components/ui/Mention';
import { cn } from '@/lib/cn';

export interface MarketCommentView {
  id: string;
  /** Null once the author has deleted their account. */
  userId: string | null;
  nickname: string | null;
  body: string;
  createdAt: string;
}

interface Props {
  groupId: string;
  marketId: string;
  /** Oldest first; the list renders top to bottom so the newest sits at the bottom. */
  comments: MarketCommentView[];
  viewerId: string;
  /** Group owner or moderator: can delete anyone's comment. */
  canModerate: boolean;
  /** A voided market's thread stays readable but takes no new comments (add_market_comment's rule). */
  closed: boolean;
}

const inputClasses =
  'w-full resize-none rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-[15px] leading-[1.45] text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** "just now" / "4m" / "3h" / "2d" / a short date. Short on purpose: the thread is read for what
    people said, and the exact minute is rarely what anyone opened it for. */
function shortAge(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The comment thread under a market: list, then a plain textarea and a Send button. No
 * realtime, no optimistic rows: a post lands, the textarea clears, and router.refresh()
 * brings the server's copy back down. Marks the thread read on mount and again after each
 * post, which is what keeps the market card's unread badge and the heating-up push honest.
 * Only ever mounted for a member who can already see the market, so it never has to hide
 * itself; the public-group switch is decided by MarketCommentsSection before this renders.
 */
export function MarketComments({ groupId, marketId, comments, viewerId, canModerate, closed }: Props) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reporting, setReporting] = useState<MarketCommentView | null>(null);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState(false);
  // Ages are computed client-side only (Date.now() on the server would never match the
  // client's), so the first paint shows no age and the effect fills them in.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    void markMarketCommentsRead(marketId);
  }, [marketId, comments.length]);

  function send() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await addMarketComment(groupId, marketId, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody('');
      await markMarketCommentsRead(marketId);
      router.refresh();
    });
  }

  function remove(commentId: string) {
    setError(null);
    setMenuFor(null);
    startTransition(async () => {
      const result = await deleteMarketComment(groupId, marketId, commentId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitReport() {
    if (!reporting) return;
    setError(null);
    const commentId = reporting.id;
    const trimmedReason = reason.trim();
    startTransition(async () => {
      const result = await reportMarketComment(commentId, trimmedReason || null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReporting(null);
      setReason('');
      setReported(true);
    });
  }

  const nearCap = body.length >= MARKET_COMMENT_MAX_LENGTH - 60;

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-bold tracking-[1.4px] text-espresso-400 uppercase">Comments</p>
        {comments.length > 0 && <span className="text-xs text-espresso-400">{comments.length}</span>}
      </div>

      {comments.length === 0 ? (
        <p className="text-sm text-espresso-400">{closed ? 'Nobody said anything.' : 'Nothing here yet. Say something.'}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const mine = c.userId === viewerId;
            const canDelete = mine || canModerate;
            const menuOpen = menuFor === c.id;
            return (
              <li key={c.id} className="relative">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-espresso-500">
                    {c.nickname ? <Mention nickname={c.nickname} className="font-semibold text-espresso-700" /> : <span className="italic">a former member</span>}
                    {now !== null && <span suppressHydrationWarning> · {shortAge(c.createdAt, now)}</span>}
                  </p>
                  <button
                    type="button"
                    aria-label="Comment options"
                    onClick={() => setMenuFor(menuOpen ? null : c.id)}
                    className="-mr-1 shrink-0 rounded-full px-1.5 text-base leading-none text-espresso-300 hover:bg-espresso-50 hover:text-espresso-600"
                  >
                    ···
                  </button>
                </div>
                <p className="mt-0.5 text-[14.5px] leading-[1.45] whitespace-pre-line break-words text-espresso-800">{c.body}</p>

                {menuOpen && (
                  <>
                    <button type="button" aria-label="Close comment options" onClick={() => setMenuFor(null)} className="fixed inset-0 z-0 cursor-default" />
                    <div className="absolute top-5 right-0 z-[1] w-36 overflow-hidden rounded-xl bg-paper-white shadow-lg ring-1 ring-espresso-200/60">
                      {canDelete && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => remove(c.id)}
                          className="block w-full px-3 py-2 text-left text-sm text-danger-700 hover:bg-espresso-50"
                        >
                          Delete
                        </button>
                      )}
                      {!mine && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuFor(null);
                            setReported(false);
                            setReporting(c);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-espresso-700 hover:bg-espresso-50"
                        >
                          Report
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {reported && <p className="text-xs text-espresso-500">Thanks, we&apos;ll take a look.</p>}
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {!closed && (
        <div className="space-y-2 border-t border-espresso-100 pt-3">
          {/* No autoFocus, same reasoning as ClarificationRequests: on the WebViews this app
              targets, an auto-focused field pops the keyboard on mount and drags every
              bottom-pinned bar up with it. */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment"
            rows={2}
            maxLength={MARKET_COMMENT_MAX_LENGTH}
            className={inputClasses}
          />
          <div className="flex items-center justify-between gap-3">
            <span className={cn('text-[11px]', nearCap ? (body.length >= MARKET_COMMENT_MAX_LENGTH ? 'text-danger-700' : 'text-espresso-400') : 'invisible')}>
              {body.length}/{MARKET_COMMENT_MAX_LENGTH}
            </span>
            <Button size="sm" disabled={isPending || !body.trim()} onClick={send}>
              Send
            </Button>
          </div>
        </div>
      )}

      {reporting && (
        <Modal
          onClose={() => {
            setReporting(null);
            setReason('');
          }}
        >
          <p className="font-display font-bold text-espresso-900">Report this comment</p>
          <p className="text-sm text-espresso-500">
            Sends it to the Barbets team, with who wrote it and where. Nobody in the group is told.
          </p>
          <p className="rounded-xl bg-espresso-50 px-3 py-2 text-sm whitespace-pre-line break-words text-espresso-700">{reporting.body}</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What's wrong with it? (optional)"
            rows={2}
            maxLength={MARKET_COMMENT_MAX_LENGTH}
            className={inputClasses}
          />
          {error && <p className="text-sm text-danger-700">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setReporting(null);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button className="flex-1" disabled={isPending} onClick={submitReport}>
              Report
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
