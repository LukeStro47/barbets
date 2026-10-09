'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postComment, revealBet } from '@/lib/actions/comments';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { formatTokens } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';

const MAX_LENGTH = 2000;

export interface ComposerUser {
  userId: string;
  nickname: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
}

/**
 * 4e's composer: pinned to the bottom edge, your avatar, a pill field, a 36px send tile that
 * lights up signal once there's something to send.
 *
 * Typing "@" offers the members who can see this market; picking one fills in their name, and
 * they get a push when it's posted (_emit_comment_mentions). If you have an unrevealed bet, a
 * toggle above the field attaches it to this comment ("Reveal my bet"): the clearest place for
 * it, since revealing is something you do while saying something.
 */
export function CommentComposer({
  groupId,
  marketId,
  me,
  mentionable = [],
  revealable,
}: {
  groupId: string;
  marketId: string;
  me: ComposerUser;
  mentionable?: string[];
  revealable?: { label: string; amount: number } | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [caret, setCaret] = useState(0);
  const [attachBet, setAttachBet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ready = body.trim().length > 0 && !isPending;

  // The "@partial" immediately before the caret, if any.
  const beforeCaret = body.slice(0, caret);
  const token = /(?:^|\s)@([A-Za-z0-9_]*)$/.exec(beforeCaret)?.[1];
  const suggestions =
    token !== undefined ? mentionable.filter((n) => n.toLowerCase().startsWith(token.toLowerCase())).slice(0, 5) : [];

  function pickMention(nickname: string) {
    const start = beforeCaret.length - (token?.length ?? 0);
    const next = `${body.slice(0, start)}${nickname} ${body.slice(caret)}`;
    setBody(next.slice(0, MAX_LENGTH));
    const pos = start + nickname.length + 1;
    setCaret(pos);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = attachBet && revealable ? await revealBet(groupId, marketId, trimmed) : await postComment(groupId, marketId, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody('');
      setCaret(0);
      setAttachBet(false);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface px-4 pt-3 pb-[max(28px,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[430px]">
        {error && <p className="mb-2 text-[12px] font-semibold text-alert">{error}</p>}

        {suggestions.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-[14px] border border-hairline bg-surface shadow-[0_8px_20px_-14px_rgba(12,16,24,0.45)]">
            {suggestions.map((n) => (
              <button
                key={n}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(n)}
                className="flex w-full items-center gap-2.5 border-b border-row-rule px-3.5 py-2.5 text-left last:border-b-0"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tile text-[10px] font-bold text-muted">
                  {n[0]!.toUpperCase()}
                </span>
                <span className="text-[13px] font-bold text-ink">@{n}</span>
              </button>
            ))}
          </div>
        )}

        {revealable && (
          <button
            type="button"
            onClick={() => setAttachBet((a) => !a)}
            aria-pressed={attachBet}
            className={cn(
              'mb-2 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left',
              attachBet ? 'border-signal bg-signal-wash' : 'border-hairline bg-surface'
            )}
          >
            <span
              className={cn(
                'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border',
                attachBet ? 'border-signal bg-signal text-surface' : 'border-dash bg-surface'
              )}
            >
              {attachBet && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M2 6.3 4.6 9 10 3.2" />
                </svg>
              )}
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35] text-muted">
              <span className="font-bold text-ink">Reveal my bet</span> with this comment:{' '}
              <span className="font-mono font-semibold text-ink">
                {formatTokens(revealable.amount)} on {revealable.label}
              </span>
            </span>
            {attachBet && <span className="shrink-0 text-[10.5px] font-semibold text-faint">Can&apos;t be undone</span>}
          </button>
        )}

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
            ref={inputRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value.slice(0, MAX_LENGTH));
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? body.length)}
            placeholder={mentionable.length > 0 ? 'Add to the banter, @ to tag someone' : 'Add to the banter…'}
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
