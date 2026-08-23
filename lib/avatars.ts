/** The fixed set of built-in icons, served straight out of `public/avatars/` as ordinary static
 * assets rather than through Supabase Storage. They're app-authored art, identical for every
 * group and never user-supplied, so there's nothing to gate: no bucket, no RLS surface, no signed
 * URLs, and the CDN caches them like any other icon. Adding one is a PNG in that folder plus a
 * line here, with no migration involved — `groups.avatar_key` deliberately stores free text and
 * lets this list decide what actually renders (see groupAvatarSrc).
 *
 * Also reused as a user's profile picture preset (`users.avatar_preset_key`, see userAvatarSrc in
 * lib/userAvatars.ts) — the same "pick a built-in icon instead of uploading a photo" idea, and
 * there was no reason to ship a second art set for it. */
export const GROUP_AVATARS = [
  { key: 'ace', label: 'Ace' },
  { key: 'beer', label: 'Beer' },
  { key: 'buzzer', label: 'Buzzer' },
  { key: 'chip', label: 'Chip' },
  { key: 'dice', label: 'Dice' },
  { key: 'eight-ball', label: 'Eight ball' },
  { key: 'horseshoe', label: 'Horseshoe' },
  { key: 'oracle', label: 'Oracle' },
  { key: 'roulette', label: 'Roulette' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'trophy', label: 'Trophy' },
  { key: 'up', label: 'Up' },
] as const;

export type GroupAvatarKey = (typeof GROUP_AVATARS)[number]['key'];

/** The asset path for a stored avatar key, or null when there's no avatar set or the key isn't one
 * this build ships. Returning null rather than a broken `<img>` is what lets a retired avatar
 * degrade to the group's initials tile instead of a missing image. */
export function groupAvatarSrc(avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const match = GROUP_AVATARS.find((a) => a.key === avatarKey);
  return match ? `/avatars/${match.key}.png` : null;
}
