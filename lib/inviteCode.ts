/** Invite codes are 4 characters. Anything A-Z0-9 is accepted on the way in, which is wider than
 * what gets minted: codes generated before 20260813140000_invite_code_alphabet.sql are hex
 * (md5's alphabet), newer ones come from 2-9 and A-Z without I/O, and both are still live. Nothing
 * here should narrow to the current alphabet, or it would reject perfectly good older codes.
 *
 * They used to carry a literal "BB-" prefix
 * (dropped in 20260810140000_invite_codes_drop_bb_prefix.sql), and cards, screenshots, and
 * already-shared /join/BB-XXXX links out in the world still have it — so every path into a
 * join tolerates the legacy prefix on the way in rather than 404ing an invite that was
 * perfectly valid when it was sent. This is the one place that knows the old format exists. */
export const INVITE_CODE_LENGTH = 4;

/** Uppercases, drops a legacy "BB-"/"BB" prefix, and strips anything that isn't A-Z0-9 (spaces,
 * dashes, and the stray punctuation a pasted code picks up). Returns at most
 * INVITE_CODE_LENGTH characters, so it's safe to feed straight into a lookup. */
export function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^BB[-\s]?/, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, INVITE_CODE_LENGTH);
}
