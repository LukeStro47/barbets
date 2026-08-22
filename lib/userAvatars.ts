const AVATAR_BUCKET = 'avatars';

/** The public URL for a user's uploaded profile picture, or null when they haven't set one.
 * `avatarUpdatedAt` doubles as both "has an avatar at all" and the cache-busting query param —
 * the object path itself is always `{userId}.jpg` (upserted on every re-upload), so there's
 * nothing else to store or pass in. Mirrors `groupAvatarSrc()` in lib/avatars.ts. */
export function userAvatarSrc(userId: string, avatarUpdatedAt: string | null | undefined): string | null {
  if (!avatarUpdatedAt) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${userId}.jpg?v=${encodeURIComponent(avatarUpdatedAt)}`;
}
