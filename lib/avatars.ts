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
  { key: 'football', label: 'Football' },
  { key: 'horseshoe', label: 'Horseshoe' },
  { key: 'oracle', label: 'Oracle' },
  { key: 'roulette', label: 'Roulette' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'trophy', label: 'Trophy' },
  { key: 'up', label: 'Up' },
] as const;

export type GroupAvatarKey = (typeof GROUP_AVATARS)[number]['key'];

/** One-off group logos: real PNGs under public/avatars/, resolved the same way as GROUP_AVATARS,
 * but deliberately a separate list so they never show up in a picker. Each belongs to a single
 * group (a fan-community crest, not a general-purpose icon) and is set directly on that group's
 * `avatar_key` rather than through the owner-facing logo grid in GroupIdentitySheet, which only
 * ever maps over GROUP_AVATARS. Not consulted by userAvatarSrc()/presetAvatarSrc() either, so it
 * can't end up as anyone's profile-picture preset. */
const EXCLUSIVE_GROUP_AVATARS = [{ key: 'rutgers', label: 'Rutgers' }] as const;

/** The asset path for a stored avatar key, or null when there's no avatar set or the key isn't one
 * this build ships. Returning null rather than a broken `<img>` is what lets a retired avatar
 * degrade to the group's initials tile instead of a missing image. Resolves both the pickable set
 * and the exclusive one, since this is what actually renders a group's chip (GroupAvatar) wherever
 * it's shown, including for a group whose logo was set outside the picker. */
export function groupAvatarSrc(avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const match = GROUP_AVATARS.find((a) => a.key === avatarKey) ?? EXCLUSIVE_GROUP_AVATARS.find((a) => a.key === avatarKey);
  return match ? `/avatars/${match.key}.png` : null;
}

/** Same as groupAvatarSrc(), but only ever resolves the pickable set — the one userAvatarSrc()
 * uses for a profile-picture preset, so an exclusive group logo can never render as anyone's
 * avatar even via a hand-crafted `avatar_preset_key`. */
export function presetAvatarSrc(avatarKey: string | null | undefined): string | null {
  if (!avatarKey) return null;
  const match = GROUP_AVATARS.find((a) => a.key === avatarKey);
  return match ? `/avatars/${match.key}.png` : null;
}
