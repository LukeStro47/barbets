'use client';

import { cloneElement, isValidElement, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadAvatar, removeAvatar, setAvatarPreset } from '@/lib/actions/profile';
import { GROUP_AVATARS } from '@/lib/avatars';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AvatarCropper } from '@/components/profile/AvatarCropper';
import { cn } from '@/lib/cn';

type Step = 'closed' | 'menu' | 'cropping';

/**
 * The one place a profile picture gets edited — its trigger lives on /profile/account now,
 * alongside email/password/delete, rather than as its own row on the main /profile page.
 *
 * `trigger` is whatever's tappable to open this (the avatar itself, sized however the caller
 * needs), passed as an already-rendered element rather than a render-prop function: a function
 * can't cross the server/client boundary (it isn't a Server Action), so the caller renders the
 * markup and this component clones an onClick onto it instead. The sheet it opens offers
 * uploading a photo (through AvatarCropper) or picking one of the app's built-in icons (the same
 * GROUP_AVATARS set a group's own logo uses) — a photo and a preset are mutually exclusive,
 * enforced server-side.
 */
export function AvatarPicker({
  userId,
  nickname,
  avatarUpdatedAt,
  avatarPresetKey,
  trigger,
}: {
  userId: string;
  nickname: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
  trigger: React.ReactElement<{ onClick?: () => void }>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('closed');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function close() {
    setStep('closed');
    setPendingFile(null);
    setError(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPendingFile(file);
    setStep('cropping');
  }

  function submitCropped(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);
    startTransition(async () => {
      const result = await uploadAvatar(formData);
      if (result.error) {
        setError(result.error);
        setStep('menu');
      } else {
        close();
        router.refresh();
      }
    });
  }

  function pickPreset(key: string) {
    startTransition(async () => {
      const result = await setAvatarPreset(key);
      if (result.error) setError(result.error);
      else {
        close();
        router.refresh();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = avatarPresetKey ? await setAvatarPreset(null) : await removeAvatar();
      if (result.error) setError(result.error);
      else {
        close();
        router.refresh();
      }
    });
  }

  return (
    <>
      {isValidElement(trigger) ? cloneElement(trigger, { onClick: () => setStep('menu') }) : trigger}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      {step === 'menu' && (
        <Modal onClose={close}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Profile picture</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}

          <div className="flex justify-center py-1">
            <UserAvatar
              userId={userId}
              nickname={nickname}
              avatarUpdatedAt={avatarUpdatedAt}
              avatarPresetKey={avatarPresetKey}
              className="h-20 w-20 text-2xl"
              fallbackClassName="bg-espresso-50 text-honey-700"
            />
          </div>

          <Button type="button" variant="outline" className="w-full" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
            Upload a photo
          </Button>

          <div className="space-y-2">
            <p className="text-xs font-bold text-espresso-500">Or pick an icon</p>
            <div className="flex flex-wrap gap-2.5">
              {GROUP_AVATARS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  disabled={isPending}
                  onClick={() => pickPreset(a.key)}
                  aria-pressed={avatarPresetKey === a.key}
                  title={a.label}
                  className={cn(
                    'flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-[1.5px] transition-colors',
                    avatarPresetKey === a.key ? 'border-honey-500 bg-honey-50' : 'border-espresso-200 bg-paper-white'
                  )}
                >
                  <img src={`/avatars/${a.key}.png`} alt={a.label} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {(avatarUpdatedAt || avatarPresetKey) && (
            <button
              type="button"
              disabled={isPending}
              onClick={remove}
              className="w-full text-center text-[12.5px] font-semibold text-danger-700 hover:underline"
            >
              Remove and use initials
            </button>
          )}
        </Modal>
      )}

      {step === 'cropping' && pendingFile && (
        <Modal onClose={close}>
          <AvatarCropper file={pendingFile} busy={isPending} onCancel={() => setStep('menu')} onConfirm={submitCropped} />
        </Modal>
      )}
    </>
  );
}
