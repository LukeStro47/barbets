'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postComment, revealBet } from '@/lib/actions/comments';
import { formatTokens } from '@/lib/formatNumber';

const MAX_LENGTH = 2000;

export function CommentComposer({
  groupId,
  marketId,
  /** Present only when the viewer has a bet on this market they haven't already revealed here. */
  revealable,
}: {
  groupId: string;
  marketId: string;
  revealable?: { label: string; amount: number } | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(action: 'comment' | 'reveal') {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = action === 'reveal' ? await revealBet(groupId, marketId, trimmed) : await postComment(groupId, marketId, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody('');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
        placeholder="Add to the banter..."
        rows={2}
        className="w-full resize-none rounded-[14px] border border-hairline bg-surface px-3.5 py-3 text-[13.5px] text-ink placeholder:text-faint focus:border-signal focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-faint">{body.length}/{MAX_LENGTH}</span>
        <div className="flex items-center gap-2">
          {revealable && (
            <button
              type="button"
              disabled={isPending || !body.trim()}
              onClick={() => submit('reveal')}
              className="rounded-[14px] border border-signal px-3.5 py-2 text-[12.5px] font-bold text-signal-deep disabled:opacity-40"
              title={`Post this with your bet attached: ${formatTokens(revealable.amount)} on ${revealable.label}`}
            >
              Post + reveal my bet
            </button>
          )}
          <button
            type="button"
            disabled={isPending || !body.trim()}
            onClick={() => submit('comment')}
            className="rounded-[14px] bg-signal px-4 py-2 text-[12.5px] font-bold text-surface disabled:opacity-40"
          >
            Post
          </button>
        </div>
      </div>
      {error && <p className="text-[11.5px] text-alert">{error}</p>}
    </div>
  );
}
