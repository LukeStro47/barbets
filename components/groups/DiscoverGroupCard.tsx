'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { joinPublicGroup } from '@/lib/actions/discover';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { numberWord } from '@/lib/formatNumber';
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
        'shrink-0 rounded-full border border-espresso-200 font-semibold text-espresso-600',
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
        <div className="rounded-[20px] border border-espresso-100 bg-paper-white p-[15px]">
          <div className="flex items-center gap-[11px]">
            <GroupAvatar name={name} avatarKey={avatarKey} className="h-[42px] w-[42px] text-[13px]" fallbackClassName="bg-espresso-50 text-espresso-500" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <p className="truncate font-display text-[15.5px] font-extrabold tracking-[-0.01em] text-espresso-950">{name}</p>
                <span className="shrink-0 rounded-full bg-honey-100 px-1.5 py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-honey-700 uppercase">
                  Public
                </span>
              </span>
              <p className="mt-[3px] flex items-center gap-1.5 text-xs text-espresso-500">
                <span>{openCopy}</span>
                <span className="text-espresso-200">·</span>
                <span>{numberWord(memberCount)} playing</span>
              </p>
            </span>
            {joinButton}
          </div>
          {featuredMarketTitle && (
            <div className="mt-3 flex items-center gap-[9px] rounded-[13px] bg-paper-dim px-3 py-2.5">
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-espresso-600">&ldquo;{featuredMarketTitle}&rdquo;</p>
              {!!featuredMarketBetCount && (
                <span className="shrink-0 text-[11px] font-bold text-espresso-400">{featuredMarketBetCount} bets</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[24px] border border-espresso-100 bg-paper-white">
          <div className="px-[18px] pt-[18px] pb-4">
            <div className="flex items-start gap-[11px]">
              <GroupAvatar name={name} avatarKey={avatarKey} className="h-[46px] w-[46px] text-[13px]" fallbackClassName="bg-espresso-50 text-espresso-500" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <p className="truncate font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">{name}</p>
                  <span className="shrink-0 rounded-full bg-honey-100 px-1.5 py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-honey-700 uppercase">
                    Public
                  </span>
                </span>
                <p className="mt-1 text-[12.5px] text-espresso-500">
                  {numberWord(memberCount)} playing{settlesCopy ? ` · ${settlesCopy}` : ''}
                </p>
              </span>
            </div>

            <p className="mt-4 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">
              {openMarketCount} {openMarketCount === 1 ? 'market' : 'markets'} open
            </p>
            {featuredMarketTitle && (
              <div className="mt-[9px] flex items-center gap-[10px] rounded-[13px] bg-paper-dim px-[13px] py-[11px]">
                <p className="min-w-0 flex-1 text-[13.5px] font-bold text-espresso-800">{featuredMarketTitle}</p>
                {!!featuredMarketBetCount && (
                  <span className="shrink-0 text-[12.5px] font-extrabold tabular-nums text-espresso-500">{featuredMarketBetCount} bets</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-[10px] border-t border-espresso-50 px-[18px] py-[13px]">
            <p className="min-w-0 flex-1 text-[11.5px] text-espresso-400">{openCopy}</p>
            {joinButton}
          </div>
        </div>
      )}

      {joining && (
        <Modal onClose={() => setJoining(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Join {name}</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}

          <div className="flex items-baseline gap-1 border-b-2 border-honey-500 pb-2">
            <span className="font-display text-xl font-extrabold text-espresso-400">@</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toLowerCase())}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
              aria-label="Nickname"
              className="w-full min-w-0 bg-transparent font-display text-xl font-extrabold text-espresso-900 caret-honey-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-espresso-500">One word, letters, numbers and underscores.</p>

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
