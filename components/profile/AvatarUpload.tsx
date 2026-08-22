'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadAvatar, removeAvatar } from '@/lib/actions/profile';
import { compressAvatarImage } from '@/lib/compressImage';
import { Button } from '@/components/ui/Button';
import { UserAvatar } from '@/components/ui/UserAvatar';

/** Uploads immediately on picking a file rather than a separate confirm step — a profile picture
 * has no other fields riding along with it, unlike a resolution proof photo (which waits for the
 * whole proposal to submit). `router.refresh()` after a successful upload/remove is what picks up
 * the new avatar_updated_at from the server, since this component only holds a local object-URL
 * preview in the meantime. */
export function AvatarUpload({
  userId,
  nickname,
  avatarUpdatedAt,
}: {
  userId: string;
  nickname: string;
  avatarUpdatedAt: string | null;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressAvatarImage(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(compressed));
      const formData = new FormData();
      formData.append('avatar', compressed);
      startTransition(async () => {
        const result = await uploadAvatar(formData);
        if (result.error) {
          setError(result.error);
        } else {
          router.refresh();
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process that photo.');
    }
  }

  return (
    <div className="flex items-center gap-4">
      <span className="relative">
        {preview ? (
          <img src={preview} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <UserAvatar
            userId={userId}
            nickname={nickname}
            avatarUpdatedAt={avatarUpdatedAt}
            className="h-16 w-16 text-lg"
            fallbackClassName="bg-espresso-50 text-honey-700"
          />
        )}
      </span>
      <div className="flex-1 space-y-1.5">
        {error && <p className="text-sm text-danger-700">{error}</p>}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
            {isPending ? 'Uploading…' : avatarUpdatedAt ? 'Change photo' : 'Upload a photo'}
          </Button>
          {avatarUpdatedAt && !preview && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeAvatar();
                  if (result.error) setError(result.error);
                  else router.refresh();
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
