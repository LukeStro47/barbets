import { cn } from '@/lib/cn';
import { initials } from '@/lib/initials';
import { groupAvatarSrc } from '@/lib/avatars';

/** The rounded chip that stands in for a group everywhere it's listed (groups hub, the bottom
 * nav's switcher, the profile's group list). Shows the group's chosen avatar when it has one and
 * falls back to its initials otherwise, so a group that never picks a logo looks exactly as it
 * always did. A plain <img>, not next/image: these are already-small fixed-size PNGs served from
 * public/, and routing them through the optimizer buys nothing while adding a network request the
 * service worker hasn't cached (the same reasoning /offline and RevealTicket use). */
export function GroupAvatar({
  name,
  avatarKey,
  className,
  /** Applied only to the initials fallback — an avatar image fills the chip itself. */
  fallbackClassName,
}: {
  name: string;
  avatarKey?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  const src = groupAvatarSrc(avatarKey);

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden font-extrabold',
        !src && fallbackClassName,
        className
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}
