'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postComment } from '@/lib/actions/comments';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { cn } from '@/lib/cn';

const MAX_LENGTH = 2000;

export interface ComposerUser {
  userId: string;
  nickname: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
}

/** 4e's composer: pinned to the bottom edge, your avatar, a pill field, a 36px send tile that
 *  lights up signal once there's something to send. */
export function CommentComposer({ groupId, marketId, me }: { groupId: string; marketId: string; me: ComposerUser }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ready = body.trim().length > 0 && !isPending;

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await postComment(groupId, marketId, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody('');
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface px-4 pt-3 pb-[max(28px,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[430px]">
        {error && <p className="mb-2 text-[12px] font-semibold text-alert">{error}</p>}
        <form
          className="flex items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <UserAvatar
            userId={me.userId}
            nickname={me.nickname}
            avatarUpdatedAt={me.avatarUpdatedAt}
            avatarPresetKey={me.avatarPresetKey}
            className="h-8 w-8 text-[11px]"
            fallbackClassName="bg-tile text-muted"
          />
          <input
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
            placeholder="Add to the banter…"
            className="min-w-0 flex-1 rounded-full border border-hairline bg-canvas px-[15px] py-[11px] text-[13px] text-ink placeholder:text-faint focus:border-signal focus:outline-none"
          />
          <button
            type="submit"
            disabled={!ready}
            aria-label="Send"
            className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', ready ? 'bg-signal text-surface' : 'bg-disabled-bg text-faint')}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
