import { presetAvatarSrc } from './avatars';

const AVATAR_BUCKET = 'avatars';

/** The rendered src for a user's profile picture, or null when they haven't set one. A chosen
 * preset (one of the same built-in icons groups use, see groupAvatarSrc) always wins over an
 * uploaded photo — the two are mutually exclusive server-side (set_avatar_preset/
 * set_avatar_uploaded each clear the other), so this is really just "whichever one is set,"
 * not a priority call. `avatarUpdatedAt` doubles as both "has a photo at all" and the
 * cache-busting query param for it — the object path itself is always `{userId}.jpg` (upserted
 * on every re-upload), so there's nothing else to store or pass in. Uses presetAvatarSrc(), not
 * groupAvatarSrc(), so a group-exclusive logo (avatars.ts's EXCLUSIVE_GROUP_AVATARS) can never
 * render as a profile picture. */
export function userAvatarSrc(
  userId: string,
  avatarUpdatedAt: string | null | undefined,
  avatarPresetKey?: string | null
): string | null {
  const presetSrc = presetAvatarSrc(avatarPresetKey);
  if (presetSrc) return presetSrc;
  if (!avatarUpdatedAt) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${userId}.jpg?v=${encodeURIComponent(avatarUpdatedAt)}`;
}
