'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/initials';
import { userAvatarSrc } from '@/lib/userAvatars';
import { Modal } from '@/components/ui/Modal';

/** The circular chip that stands in for a person, mirroring GroupAvatar's shape. Shows their
 * uploaded profile picture when they have one and falls back to initials otherwise, so a member
 * who never uploads a photo looks exactly as they always did. A plain <img>, not next/image: this
 * is a small fixed-size public Storage object, and the optimizer buys nothing here. */
export function UserAvatar({
  userId,
  nickname,
  avatarUpdatedAt,
  avatarPresetKey,
  className,
  fallbackClassName,
  enlargeOnTap = false,
}: {
  userId: string;
  nickname: string;
  avatarUpdatedAt?: string | null;
  avatarPresetKey?: string | null;
  /** Size and colors only — the chip's shape (a circle) is owned here, not by the caller. */
  className?: string;
  fallbackClassName?: string;
  /** Lets tapping the chip open the photo full-size in a lightbox — for a profile's hero avatar,
   * not for identity chips used inline in rows/lists, which stay plain. Only does anything when
   * there's a real photo: initials have nothing bigger to show. */
  enlargeOnTap?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const src = userAvatarSrc(userId, avatarUpdatedAt, avatarPresetKey);
  const canEnlarge = enlargeOnTap && !!src;

  const chip = (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-extrabold',
        !src && fallbackClassName,
        className
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(nickname)}
    </span>
  );

  if (!canEnlarge) return chip;

  return (
    <>
      <button type="button" onClick={() => setExpanded(true)} aria-label={`View ${nickname}'s profile picture`}>
        {chip}
      </button>
      {expanded && (
        <Modal
          onClose={() => setExpanded(false)}
          padded={false}
          panelClassName="aspect-square w-[min(80vw,340px)] max-w-[min(80vw,340px)] rounded-full bg-transparent shadow-none"
        >
          <img src={src as string} alt="" onClick={() => setExpanded(false)} className="h-full w-full rounded-full object-cover" />
        </Modal>
      )}
    </>
  );
}
