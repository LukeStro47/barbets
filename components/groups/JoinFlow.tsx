'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { joinGroup, getGroupJoinMessage, checkInviteNickname } from '@/lib/actions/groups';
import { setAvatarPreset } from '@/lib/actions/profile';
import { Button } from '@/components/ui/Button';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AvatarPicker } from '@/components/profile/AvatarPicker';
import { Modal } from '@/components/ui/Modal';
import { FooterButton, ScreenHeader, StickyFooter } from '@/components/ui/Screen';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { OpenAppPrompt } from '@/components/groups/OpenAppPrompt';
import { JoinedConfirmation } from '@/components/groups/JoinedConfirmation';
import { formatTokens } from '@/lib/formatNumber';
import { formatGroupAge } from '@/lib/formatRelativeTime';
import { isMobileBrowserUA } from '@/lib/mobileBrowser';
import { cn } from '@/lib/cn';
import type { JoinSource } from '@/lib/inviteLink';

const NICKNAME_MAX_LENGTH = 20;
const NICKNAME_FORMAT = /^[a-z0-9_]{1,20}$/;
/** 5d's face row: the first five presets the mock draws, in its order. */
const FACE_ROW = ['beer', 'football', 'horseshoe', 'ace', 'chip'];

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

export type InviteFace = {
  user_id: string;
  initial: string;
  avatar_updated_at: string | null;
  avatar_preset_key: string | null;
};

export type InviteDetails = {
  memberCount: number;
  openCount: number;
  settledCount: number;
  createdAt: string;
  /** null during a season intermission: join_group() lands the joiner dormant on 0 then. */
  openingBalance: number | null;
  resolutionWindowHours: number;
  faces: InviteFace[];
};

/**
 * The signed-in join flow, three screens: 5e (the invite: who's in, how busy it is), 5d (the name
 * this group will know you by, a face, the opening balance), then 5g (you're in). 5e shows counts
 * and faces only, never market questions: market content stays member-only (see
 * get_invite_details' migration). `blockedReason` still renders 5e normally so there's always
 * something to look at and a way back; Join just explains why it won't work.
 *
 * The face is account-level (see the design-decision note in ARCHITECTURE.md), so a preset picked
 * here is only saved once the join itself succeeds: backing out of someone else's group shouldn't
 * change the face your other groups see.
 */
export function JoinFlow({
  inviteCode,
  joinSource = null,
  groupName,
  groupAvatarKey = null,
  blockedReason = null,
  details,
  userId,
  avatarPresetKey,
  avatarUpdatedAt,
}: {
  inviteCode: string;
  /** Recorded on the group_join lifecycle row so admin can compare QR vs typed vs link. */
  joinSource?: JoinSource | null;
  groupName: string;
  groupAvatarKey?: string | null;
  blockedReason?: 'removed' | 'not_accepting' | null;
  details: InviteDetails;
  userId: string;
  avatarPresetKey: string | null;
  avatarUpdatedAt: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'invite' | 'nickname' | 'joined' | 'open-app'>('invite');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [nickname, setNickname] = useState('');
  const [free, setFree] = useState<boolean | null>(null);
  const [face, setFace] = useState<string | null>(avatarPresetKey);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [joined, setJoined] = useState<{ groupId: string; balance: number; message: string | null } | null>(null);
  const [isBrowserJoin, setIsBrowserJoin] = useState(false);
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);

  // There's no MobileAppGate any more, so a browser join always finishes and lands someone in
  // their group either way - this only decides whether OpenAppPrompt's nudge shows in between.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (isStandalone) return;
    if (!isMobileBrowserUA(navigator.userAgent)) return;
    setIsBrowserJoin(true);
  }, []);

  // An upload or pick made in AvatarPicker's sheet saves straight away and refreshes these props;
  // follow it, so Join doesn't then overwrite that choice with a stale preset from this row.
  useEffect(() => {
    setFace(avatarPresetKey);
  }, [avatarPresetKey, avatarUpdatedAt]);

  // 5d's live Free/Taken pill, debounced so it asks once the typing pauses.
  useEffect(() => {
    setFree(null);
    if (!NICKNAME_FORMAT.test(nickname)) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const result = await checkInviteNickname(inviteCode, nickname);
      if (!cancelled && !result.error) setFree(result.data ?? null);
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [nickname, inviteCode]);

  function proceedToGroup(groupId: string) {
    if (isBrowserJoin) {
      setJoined(null);
      setJoinedGroupId(groupId);
      setStep('open-app');
    } else {
      router.push(`/groups/${groupId}`);
    }
  }

  function join() {
    startTransition(async () => {
      setError(null);
      const result = await joinGroup(inviteCode, nickname.trim(), joinSource);
      if (result.error) {
        setError(result.error);
        return;
      }
      localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
      const groupId = result.data!.group_id;
      // Best-effort, both of these: neither should stop someone who already joined from landing.
      if (face && face !== avatarPresetKey) await setAvatarPreset(face);
      const messageResult = await getGroupJoinMessage(groupId);
      setJoined({ groupId, balance: result.data!.balance, message: messageResult.data ?? null });
      setStep('joined');
    });
  }

  if (step === 'open-app' && joinedGroupId) {
    return <OpenAppPrompt groupName={groupName} inviteCode={inviteCode} onContinueInBrowser={() => router.push(`/groups/${joinedGroupId}`)} />;
  }

  if (step === 'joined' && joined) {
    return (
      <JoinedConfirmation
        groupName={groupName}
        groupAvatarKey={groupAvatarKey}
        balance={joined.balance}
        joinMessage={joined.message}
        openCount={details.openCount}
        resolutionWindowHours={details.resolutionWindowHours}
        onContinue={() => proceedToGroup(joined.groupId)}
      />
    );
  }

  if (step === 'invite') {
    const extra = Math.max(0, details.memberCount - details.faces.length);
    return (
      <div className="mx-auto w-full max-w-[430px] px-[22px] pt-[calc(env(safe-area-inset-top)+64px)] pb-[160px]">
        <p className="text-[11px] font-bold tracking-[0.1em] text-signal uppercase">You&apos;ve been invited</p>

        <div className="mt-3.5 rounded-[24px] border border-hairline bg-surface p-5 shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
          <div className="flex items-center gap-[13px]">
            <GroupAvatar
              name={groupName}
              avatarKey={groupAvatarKey}
              className="h-[52px] w-[52px] text-lg"
              radiusClassName="rounded-2xl"
              fallbackClassName="bg-tile text-signal"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[20px] leading-[1.2] font-extrabold tracking-[-0.02em] text-balance text-ink">{groupName}</span>
              <span className="mt-[3px] block text-[12.5px] text-faint">
                {details.memberCount} {details.memberCount === 1 ? 'member' : 'members'}
              </span>
            </span>
          </div>

          {details.faces.length > 0 && (
            <div className="mt-4 flex">
              {details.faces.map((f, i) => (
                <UserAvatar
                  key={f.user_id}
                  userId={f.user_id}
                  nickname={f.initial}
                  avatarUpdatedAt={f.avatar_updated_at}
                  avatarPresetKey={f.avatar_preset_key}
                  className={cn('h-[34px] w-[34px] border-2 border-surface text-[12px]', i > 0 && '-ml-2.5')}
                  fallbackClassName="bg-tile text-muted"
                />
              ))}
              {extra > 0 && (
                <span className="-ml-2.5 flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-surface bg-tile font-mono text-[11px] font-semibold text-muted">
                  +{extra}
                </span>
              )}
            </div>
          )}

          <div className="mt-4 flex border-t border-rule pt-3.5">
            {(
              [
                ['Open', String(details.openCount), 1],
                ['Settled', String(details.settledCount), 1],
                ['Running', formatGroupAge(details.createdAt), 1.2],
              ] as const
            ).map(([label, value, grow], i) => (
              <span key={label} className={cn('min-w-0', i > 0 && 'border-l border-rule pl-[13px]')} style={{ flex: grow }}>
                <span className="block text-[9.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</span>
                <span className="mt-[3px] block font-mono text-[15px] font-semibold text-ink">{value}</span>
              </span>
            ))}
          </div>
        </div>

        <p className="mt-4 text-[12px] leading-[1.55] text-faint text-pretty">
          {details.openingBalance != null
            ? `Joining gives you ${formatTokens(details.openingBalance)} credits in this group. It doesn't touch any other group you're in.`
            : "This group is between seasons, so credits arrive when the next one starts. It doesn't touch any other group you're in."}
        </p>

        <StickyFooter>
          <FooterButton onClick={() => (blockedReason ? setShowBlockedModal(true) : setStep('nickname'))}>
            <span className="block truncate px-3">Join {groupName}</span>
          </FooterButton>
          <FooterButton tone="outline" href="/groups">
            Not now
          </FooterButton>
        </StickyFooter>

        {showBlockedModal && blockedReason && (
          <Modal onClose={() => setShowBlockedModal(false)}>
            <p className="font-display font-bold text-ink">{BLOCKED_COPY[blockedReason].title}</p>
            <p className="text-sm text-muted">{BLOCKED_COPY[blockedReason].body}</p>
            <Button className="w-full" onClick={() => setShowBlockedModal(false)}>
              Got it
            </Button>
          </Modal>
        )}
      </div>
    );
  }

  // The current face leads the row when it's a preset the mock's five don't include.
  const faceRow = avatarPresetKey && !FACE_ROW.includes(avatarPresetKey) ? [avatarPresetKey, ...FACE_ROW.slice(0, 4)] : FACE_ROW;
  const hasPhoto = !avatarPresetKey && !!avatarUpdatedAt;

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title={`Join ${groupName}`}
        onTile={() => setStep('invite')}
        right={
          <span aria-label="Step 2 of 3" className="flex shrink-0 items-center gap-1">
            <span className="h-[5px] w-[18px] rounded-[3px] bg-ink" />
            <span className="h-[5px] w-[18px] rounded-[3px] bg-ink" />
            <span className="h-[5px] w-[18px] rounded-[3px] bg-edge" />
          </span>
        }
      />
      <div className="mx-auto w-full max-w-[430px] px-[22px] pt-5 pb-[140px]">
        <h1 className="text-[27px] leading-[1.14] font-extrabold tracking-[-0.025em] text-ink text-pretty">What do they call you?</h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted text-pretty">
          Just for {groupName}. Your other groups keep the name they know you by.
        </p>

        <label
          className={cn(
            'mt-5 flex h-[58px] items-center rounded-2xl border border-hairline bg-surface px-4',
            'focus-within:border-[1.5px] focus-within:border-signal focus-within:px-[15.5px] focus-within:shadow-[0_0_0_4px_rgba(45,85,245,0.08)]'
          )}
        >
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.toLowerCase().replace(/\s/g, ''))}
            maxLength={NICKNAME_MAX_LENGTH}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Nickname"
            placeholder="Your name here"
            className="min-w-0 flex-1 bg-transparent text-[17px] font-bold text-ink caret-signal placeholder:font-normal placeholder:text-disabled-ink focus:outline-none"
          />
          <span className="ml-3 font-mono text-[12px] text-faint">
            {nickname.length}/{NICKNAME_MAX_LENGTH}
          </span>
        </label>

        <div className="mt-3 flex items-center gap-[11px] rounded-2xl border border-hairline bg-surface px-4 py-[13px]">
          <span className="text-[14px] font-bold text-ink">Handle</span>
          <span className="min-w-0 truncate font-mono text-[14px] font-semibold text-signal">@{nickname || 'yourname'}</span>
          {nickname && !NICKNAME_FORMAT.test(nickname) ? (
            <span className="ml-auto shrink-0 text-[11px] font-semibold text-faint">Letters, numbers, _</span>
          ) : free === true ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-[5px] rounded-full bg-gain-bg px-[9px] py-1 text-[11px] font-bold text-gain">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M2 6.3 4.6 9 10 3.2" />
              </svg>
              Free
            </span>
          ) : free === false ? (
            <span className="ml-auto shrink-0 rounded-full bg-alert-bg px-[9px] py-1 text-[11px] font-bold text-alert">Taken</span>
          ) : null}
        </div>

        {error && <p className="mt-3 text-[12px] font-semibold text-alert">{error}</p>}

        <p className="mt-[22px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Pick a face</p>
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          {hasPhoto && (
            <button
              type="button"
              onClick={() => setFace(null)}
              aria-pressed={face === null}
              className={cn('flex h-[60px] w-[60px] items-center justify-center rounded-full p-0.5', face === null && 'border-[2.5px] border-signal')}
            >
              <UserAvatar
                userId={userId}
                nickname={nickname || '?'}
                avatarUpdatedAt={avatarUpdatedAt}
                className={cn('h-full w-full', face !== null && 'opacity-85')}
              />
            </button>
          )}
          {faceRow.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFace(key)}
              aria-pressed={face === key}
              aria-label={key}
              className={cn('flex h-[60px] w-[60px] items-center justify-center rounded-full', face === key && 'border-[2.5px] border-signal p-0.5')}
            >
              <img src={`/avatars/${key}.png`} alt="" className={cn('h-full w-full rounded-full object-cover', face !== key && 'opacity-85')} />
            </button>
          ))}
          <AvatarPicker
            userId={userId}
            nickname={nickname || '?'}
            avatarUpdatedAt={avatarUpdatedAt}
            avatarPresetKey={avatarPresetKey}
            trigger={
              <button
                type="button"
                aria-label="Upload a photo or see every face"
                className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-dashed border-dash bg-surface text-faint"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="6" width="18" height="14" rx="3" />
                  <circle cx="12" cy="13" r="3.4" />
                  <path d="M8 6l1.5-2h5L16 6" />
                </svg>
              </button>
            }
          />
        </div>

        {details.openingBalance != null && (
          <div className="mt-[22px] rounded-[18px] bg-ink px-[17px] py-4">
            <p className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">Your opening balance</p>
            <p className="mt-1.5 font-mono text-[34px] leading-none font-semibold tracking-[-0.03em] text-surface">
              {formatTokens(details.openingBalance)}
            </p>
            <p className="mt-[9px] text-[12px] leading-[1.5] text-faint text-pretty">
              Credits, not currency, and they only count in this group. Everyone joins on {formatTokens(details.openingBalance)}.
            </p>
          </div>
        )}
      </div>

      <StickyFooter>
        <FooterButton onClick={join} disabled={isPending || !NICKNAME_FORMAT.test(nickname) || free === false}>
          {isPending ? 'Joining' : 'Join the group'}
        </FooterButton>
      </StickyFooter>
    </div>
  );
}
