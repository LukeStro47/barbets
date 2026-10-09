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
        'shrink-0 rounded-full border border-dash font-semibold text-muted',
        variant === 'expanded' ? 'px-5 py-[9px] text-sm' : 'px-3 py-1.5 text-sm'
      )}
    >
      Joined
    </Link>
  ) : (
    <Button
      variant="accent"
      size={variant === 'expanded' ? 'md' : 'sm'}
      onClick={() => setJoining(true)}
      className={cn('shrink-0', variant === 'expanded' && 'px-5 py-[9px] font-extrabold')}
    >
      Join
    </Button>
  );

  const openCopy =
    openMarketCount === 0 ? 'Nothing open right now' : `${openMarketCount} open`;

  return (
    <>
      {variant === 'compact' ? (
        // 5h: the group and its Join on top, the market it's running in a wash strip underneath.
        <div className="overflow-hidden rounded-[20px] border border-hairline bg-surface shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
          <div className="flex items-center gap-3 px-[15px] py-3.5">
            <GroupAvatar
              name={name}
              avatarKey={avatarKey}
              radiusClassName="rounded-xl"
              className="h-[38px] w-[38px] text-[12px]"
              fallbackClassName="bg-tile text-muted"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-bold tracking-[-0.01em] text-ink">{name}</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-faint">
                {memberCount.toLocaleString('en-GB')} playing · {openCopy.toLowerCase()}
              </span>
            </span>
            {joined ? (
              <Link href={`/groups/${groupId}`} className="shrink-0 rounded-[10px] border border-hairline px-[13px] py-2 text-[12.5px] font-bold text-muted">
                Joined
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setJoining(true)}
                className="shrink-0 rounded-[10px] bg-signal px-[13px] py-2 text-[12.5px] font-bold text-surface"
              >
                Join
              </button>
            )}
          </div>
          {featuredMarketTitle && (
            <div className="flex items-center gap-2.5 border-t border-rule bg-wash px-[15px] py-[11px]">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">{featuredMarketTitle}</span>
              {!!featuredMarketBetCount && (
                <span className="shrink-0 font-mono text-[12px] font-semibold text-signal">
                  {featuredMarketBetCount} bet{featuredMarketBetCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[24px] border border-hairline bg-surface">
          <div className="px-[18px] pt-[18px] pb-4">
            <div className="flex items-start gap-[11px]">
              <GroupAvatar name={name} avatarKey={avatarKey} className="h-[46px] w-[46px] text-[13px]" fallbackClassName="bg-rule text-muted" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <p className="truncate font-display text-lg font-extrabold tracking-[-0.015em] text-ink">{name}</p>
                  <span className="shrink-0 rounded-full bg-signal-tint px-1.5 py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-signal-deep uppercase">
                    Public
                  </span>
                </span>
                <p className="mt-1 text-[12.5px] text-muted">
                  {memberCount} playing{settlesCopy ? ` · ${settlesCopy}` : ''}
                </p>
              </span>
            </div>

            {openMarketCount > 0 && (
              <p className="mt-4 text-[10.5px] font-extrabold tracking-[0.09em] text-faint uppercase">
                {openMarketCount} {openMarketCount === 1 ? 'market' : 'markets'} open
              </p>
            )}
            {featuredMarketTitle && (
              <div className="mt-[9px] flex items-center gap-[10px] rounded-[13px] bg-rule px-[13px] py-[11px]">
                <p className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">{featuredMarketTitle}</p>
                {!!featuredMarketBetCount && (
                  <span className="shrink-0 text-[12.5px] font-extrabold font-mono tabular-nums text-muted">{featuredMarketBetCount} bets</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-[10px] border-t border-rule px-[18px] py-[13px]">
            <p className="min-w-0 flex-1 text-[11.5px] text-faint">{openCopy}</p>
            {joinButton}
          </div>
        </div>
      )}

      {joining && (
        <Modal onClose={() => setJoining(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">Join {name}</p>
          {error && <p className="text-sm text-alert">{error}</p>}

          <div className="flex items-baseline gap-1 border-b-2 border-signal pb-2">
            <span className="font-display text-xl font-extrabold text-faint">@</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toLowerCase())}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
              aria-label="Nickname"
              className="w-full min-w-0 bg-transparent font-display text-xl font-extrabold text-ink caret-signal focus:outline-none"
            />
          </div>
          <p className="text-xs text-muted">One word, letters, numbers and underscores.</p>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setJoining(false)}>
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
