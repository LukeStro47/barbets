'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { joinPublicGroup } from '@/lib/actions/discover';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { cn } from '@/lib/cn';

const NICKNAME_MAX_LENGTH = 20;

/** One directory row plus its own instant-join flow — a single nickname prompt, no invite-code
    confirm step, since browsing here already is the confirmation. Already a member? The row
    links straight to the group instead of offering to join it again.

    Two sizes share this one join flow rather than forking it: `compact` is the groups hub's
    "Open to anyone" section (a zero-group user's first screen), `expanded` is the rebuilt
    /groups/discover browse page. Neither renders per-member avatars — a public group's roster
    never shows a face, not even an initials placeholder (see ARCHITECTURE.md's "Public groups"
    section), so both fall back to a plain playing-count instead of the stacked-avatar treatment
    a private group's cards use elsewhere. */
export function DiscoverGroupCard({
  groupId,
  name,
  avatarKey,
  memberCount,
  openMarketCount,
  featuredMarketTitle,
  featuredMarketBetCount,
  settlesCopy,
  joined = false,
  variant = 'expanded',
}: {
  groupId: string;
  name: string;
  avatarKey: string | null;
  memberCount: number;
  openMarketCount: number;
  featuredMarketTitle?: string | null;
  featuredMarketBetCount?: number;
  /** expanded only — e.g. "settles after each game". */
  settlesCopy?: string;
  joined?: boolean;
  variant?: 'compact' | 'expanded';
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submitJoin() {
    startTransition(async () => {
      const result = await joinPublicGroup(groupId, nickname.trim());
      if (result.error) {
        setError(result.error);
        return;
      }
      localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
      router.push(`/groups/${groupId}`);
    });
  }

  const joinButton = joined ? (
    <Link
      href={`/groups/${groupId}`}
      className={cn(
        'shrink-0 rounded-[14px] border border-hairline bg-surface font-bold text-muted',
        variant === 'expanded' ? 'px-5 py-[9px] text-[13.5px]' : 'px-3 py-1.5 text-[13px]'
      )}
    >
      Joined
    </Link>
  ) : (
    <Button
      variant="primary"
      size={variant === 'expanded' ? 'md' : 'sm'}
      onClick={() => setJoining(true)}
      className="shrink-0"
    >
      Join
    </Button>
  );

  const openCopy =
    openMarketCount === 0 ? (
      'Nothing open right now'
    ) : (
      <>
        <span className="font-mono text-[12.5px] font-semibold text-ink">{openMarketCount}</span> open
      </>
    );

  return (
    <>
      {variant === 'compact' ? (
        <div className="rounded-[20px] border border-hairline bg-surface px-4 py-[14px]">
          <div className="flex items-center gap-3">
            <GroupAvatar name={name} avatarKey={avatarKey} className="h-11 w-11 text-[13px]" fallbackClassName="bg-rule text-muted" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <p className="truncate text-[14.5px] font-bold text-ink">{name}</p>
                <span className="shrink-0 rounded-[8px] bg-signal-tint px-1.5 py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-signal uppercase">
                  Public
                </span>
              </span>
              <p className="mt-[3px] flex items-center gap-1.5 text-[12.5px] text-muted">
                <span>{openCopy}</span>
                <span className="text-dash">·</span>
                <span>
                  <span className="font-mono text-[12.5px] font-semibold text-ink">{memberCount}</span> playing
                </span>
              </p>
            </span>
            {joinButton}
          </div>
          {featuredMarketTitle && (
            <div className="mt-3 flex items-center gap-2 rounded-[14px] border border-hairline bg-canvas px-3 py-2.5">
              <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-muted">&ldquo;{featuredMarketTitle}&rdquo;</p>
              {!!featuredMarketBetCount && (
                <span className="shrink-0 font-mono text-[11px] font-semibold text-faint">{featuredMarketBetCount} bets</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[24px] border border-hairline bg-surface">
          <div className="px-[18px] pt-[18px] pb-4">
            <div className="flex items-start gap-3">
              <GroupAvatar name={name} avatarKey={avatarKey} className="h-11 w-11 text-[13px]" fallbackClassName="bg-rule text-muted" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <p className="truncate text-[17px] font-bold tracking-[-0.01em] text-ink">{name}</p>
                  <span className="shrink-0 rounded-[8px] bg-signal-tint px-1.5 py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-signal uppercase">
                    Public
                  </span>
                </span>
                <p className="mt-1 text-[12.5px] text-muted">
                  <span className="font-mono font-semibold text-ink">{memberCount}</span> playing
                  {settlesCopy ? ` · ${settlesCopy}` : ''}
                </p>
              </span>
            </div>

            {openMarketCount > 0 && (
              <p className="mt-4 text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">
                <span className="font-mono">{openMarketCount}</span>{' '}
                {openMarketCount === 1 ? 'market' : 'markets'} open
              </p>
            )}
            {featuredMarketTitle && (
              <div className="mt-[9px] flex items-center gap-2.5 rounded-[14px] border border-hairline bg-canvas px-[13px] py-[11px]">
                <p className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">{featuredMarketTitle}</p>
                {!!featuredMarketBetCount && (
                  <span className="shrink-0 font-mono text-[12.5px] font-semibold text-muted">{featuredMarketBetCount} bets</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5 border-t border-hairline px-[18px] py-[13px]">
            <p className="min-w-0 flex-1 text-[11.5px] text-faint">{openCopy}</p>
            {joinButton}
          </div>
        </div>
      )}

      {joining && (
        <Modal onClose={() => setJoining(false)}>
          <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">Join {name}</p>
          {error && <p className="text-sm text-alert">{error}</p>}

          <div className="flex items-center gap-1 rounded-[14px] border border-hairline bg-surface px-4 py-3 focus-within:border-signal focus-within:shadow-[0_0_0_3px_rgba(45,85,245,0.15)]">
            <span className="text-xl font-extrabold text-faint">@</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toLowerCase())}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
              aria-label="Nickname"
              className="w-full min-w-0 bg-transparent text-xl font-extrabold text-ink caret-signal focus:outline-none"
            />
          </div>
          <p className="text-[12.5px] text-muted">One word, letters, numbers and underscores.</p>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setJoining(false)}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={isPending || nickname.trim() === ''} onClick={submitJoin}>
              Join
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
