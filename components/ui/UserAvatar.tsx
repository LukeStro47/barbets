import { cn } from '@/lib/cn';
import { initials } from '@/lib/initials';
import { userAvatarSrc } from '@/lib/userAvatars';

/** The circular chip that stands in for a person, mirroring GroupAvatar's shape. Shows their
 * uploaded profile picture when they have one and falls back to initials otherwise, so a member
 * who never uploads a photo looks exactly as they always did. A plain <img>, not next/image: this
 * is a small fixed-size public Storage object, and the optimizer buys nothing here. */
export function UserAvatar({
  userId,
  nickname,
  avatarUpdatedAt,
  className,
  fallbackClassName,
}: {
  userId: string;
  nickname: string;
  avatarUpdatedAt?: string | null;
  /** Size and colors only — the chip's shape (a circle) is owned here, not by the caller. */
  className?: string;
  fallbackClassName?: string;
}) {
  const src = userAvatarSrc(userId, avatarUpdatedAt);

  return (
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
}
