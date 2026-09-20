'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { joinGroup, getGroupJoinMessage } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Modal } from '@/components/ui/Modal';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { OpenAppPrompt } from '@/components/groups/OpenAppPrompt';
import { CaretLeftIcon } from '@/components/ui/icons';
import { StickyFooter } from '@/components/ui/Shell';
import { isMobileBrowserUA } from '@/lib/mobileBrowser';
import type { JoinSource } from '@/lib/inviteLink';

const NICKNAME_MAX_LENGTH = 20;

const BLOCKED_COPY: Record<'removed' | 'not_accepting', { title: string; body: string }> = {
  removed: {
    title: "You can't rejoin this group.",
    body: 'The owner removed you from it.',
  },
  not_accepting: {
    title: "This group isn't accepting new members right now.",
    body: 'Check back later, or ask the owner to open it back up.',
  },
};

/**
 * Two steps, same shape as the old claim-username page: confirm you're
 * joining the right group, then a dedicated screen (with room for real
 * directions) to pick your nickname. `blockedReason` lets the confirm step
 * still render normally (so there's always something to look at and a way
 * back) — clicking Join just surfaces a dismissible modal explaining why it
 * won't work, instead of a dead-end page with no way out.
 *
 * The confirm step carries no Barbets mark: the group is the subject of this screen, and a
 * visitor arriving on a friend's link is being introduced to the group, not to the product.
 */
export function JoinFlow({
  inviteCode,
  joinSource = null,
  groupName,
  groupAvatarKey = null,
  blockedReason = null,
}: {
  inviteCode: string;
  /** Recorded on the group_join lifecycle row so admin can compare QR vs typed vs link. */
  joinSource?: JoinSource | null;
  groupName: string;
  groupAvatarKey?: string | null;
  blockedReason?: 'removed' | 'not_accepting' | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'confirm' | 'nickname' | 'open-app'>('confirm');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [welcome, setWelcome] = useState<{ groupId: string; message: string } | null>(null);
  const [isBrowserJoin, setIsBrowserJoin] = useState(false);
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);

  // There's no MobileAppGate any more, so a browser join always finishes and lands someone in
  // their group either way - this only decides whether OpenAppPrompt's nudge shows in between.
  // Same detection MobileAppGate used to gate on: not the native app, not an installed
  // standalone PWA, an actual phone/tablet browser.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (isStandalone) return;
    if (!isMobileBrowserUA(navigator.userAgent)) return;
    setIsBrowserJoin(true);
  }, []);

  function proceedToGroup(groupId: string) {
    if (isBrowserJoin) {
      setWelcome(null);
      setJoinedGroupId(groupId);
      setStep('open-app');
    } else {
      router.push(`/groups/${groupId}`);
    }
  }

  if (step === 'open-app' && joinedGroupId) {
    return <OpenAppPrompt groupName={groupName} inviteCode={inviteCode} onContinueInBrowser={() => router.push(`/groups/${joinedGroupId}`)} />;
  }

  if (step === 'confirm') {
    return (
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-canvas px-[22px] pt-[calc(env(safe-area-inset-top)+40px)] pb-[var(--sticky-footer-offset)]">
        <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">You&apos;re invited</p>

        <div className="mt-5 rounded-[24px] border border-hairline bg-surface px-5 pt-8 pb-8 text-center">
          <GroupAvatar
            name={groupName}
            avatarKey={groupAvatarKey}
            fallbackClassName="bg-rule text-[26px] text-muted"
            className="mx-auto h-16 w-16"
          />
          {/* balance, not pretty: a long group name has to wrap evenly across two lines here
              rather than leave one orphaned word under a full first line. */}
          <p className="mt-5 text-[26px] leading-[1.14] font-extrabold tracking-[-0.02em] text-balance text-ink">
            {groupName}
          </p>
          <p className="mt-2 text-[13.5px] leading-[1.5] text-muted">Join this group to start playing.</p>
        </div>

        <Link href="/groups" className="mt-5 block text-center text-[13.5px] font-bold text-signal">
          Not your group? Go to your groups
        </Link>

        <StickyFooter>
          <Button
            variant="primary"
            size="lg"
            className="w-full truncate"
            onClick={() => (blockedReason ? setShowBlockedModal(true) : setStep('nickname'))}
          >
            Join {groupName}
          </Button>
        </StickyFooter>

        {showBlockedModal && blockedReason && (
          <Modal onClose={() => setShowBlockedModal(false)}>
            <p className="text-[17px] font-bold text-ink">{BLOCKED_COPY[blockedReason].title}</p>
            <p className="text-[13.5px] text-muted">{BLOCKED_COPY[blockedReason].body}</p>
            <Button className="w-full" onClick={() => setShowBlockedModal(false)}>
              Got it
            </Button>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-canvas px-[22px] pt-[calc(env(safe-area-inset-top)+40px)] pb-[var(--sticky-footer-offset)]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="-ml-1 inline-flex items-center gap-0.5 text-[13px] font-bold text-muted hover:text-ink"
        >
          <CaretLeftIcon className="h-4 w-4" />
          Back
        </button>
        <span className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Step 2 of 2</span>
      </div>

      <h1 className="mt-9 text-[26px] font-extrabold tracking-[-0.02em] text-ink">Pick your name.</h1>
      <p className="mt-2 text-[13.5px] leading-[1.5] text-muted">
        This is what {groupName} will @mention you as. One word, letters, numbers and underscores.
      </p>

      {error && <p className="mt-5 text-sm text-alert">{error}</p>}

      {/* Ledger field row: the nickname is the whole point of this screen. */}
      <div className="mt-8 flex items-center gap-1 rounded-[14px] border border-hairline bg-surface px-4 py-3.5 focus-within:border-signal focus-within:shadow-[0_0_0_3px_rgba(45,85,245,0.15)]">
        <span className="text-[22px] font-extrabold text-faint">@</span>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.toLowerCase())}
          maxLength={NICKNAME_MAX_LENGTH}
          autoFocus
          aria-label="Nickname"
          className="w-full min-w-0 bg-transparent text-[22px] font-extrabold tracking-[-0.02em] text-ink caret-signal focus:outline-none"
        />
      </div>
      <span className="mt-2 font-mono text-[12.5px] font-semibold text-faint">
        {nickname.length} / {NICKNAME_MAX_LENGTH}
      </span>

      <StickyFooter>
        <Button
          variant="primary"
          size="lg"
          className="w-full truncate"
          disabled={isPending || nickname.trim() === ''}
          onClick={() =>
            startTransition(async () => {
              const result = await joinGroup(inviteCode, nickname.trim(), joinSource);
              if (result.error) {
                setError(result.error);
                return;
              }
              localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
              const groupId = result.data!.group_id;
              // Best-effort: a failure here should never block someone who already joined
              // successfully from landing in their new group.
              const messageResult = await getGroupJoinMessage(groupId);
              if (!messageResult.error && messageResult.data) {
                setWelcome({ groupId, message: messageResult.data });
              } else {
                proceedToGroup(groupId);
              }
            })
          }
        >
          Join {groupName}
        </Button>
      </StickyFooter>

      {welcome && (
        <Modal onClose={() => proceedToGroup(welcome.groupId)}>
          <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">Welcome to {groupName}</p>
          <p className="whitespace-pre-wrap text-[13.5px] leading-[1.5] text-muted">{welcome.message}</p>
          <Button className="w-full" onClick={() => proceedToGroup(welcome.groupId)}>
            Continue
          </Button>
        </Modal>
      )}
    </div>
  );
}
