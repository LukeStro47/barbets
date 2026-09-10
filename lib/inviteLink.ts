import { APP_ORIGIN } from '@/lib/appOrigin';
import { GOOGLE_PLAY_URL, APPLE_APP_STORE_URL } from '@/lib/appStores';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/lib/inviteCode';

/**
 * Everything that knows the shape of an invite *link* (as opposed to the bare 4-character code,
 * which lib/inviteCode.ts owns): the URL a QR code encodes, the `?src=` tag that says how a join
 * arrived, the store URLs that carry a code through an install, and the parsers that read a code
 * back out of any of those. Pure, no React, no Capacitor, so it's testable and safe to import
 * from a Server Component, a client component, or a route handler alike.
 *
 * Every join funnels through `/join/[code]`, and the optional `?src=` on that URL is the one
 * thing that tells a QR scan apart from a typed code or a pasted link. It travels through the
 * sign-in bounce (`/login?next=/join/CODE?src=qr`) and lands in `join_group(p_join_source)`, so
 * the admin site can compare the three from `lifecycle_events.metadata->>'source'`.
 */

export const JOIN_SOURCES = ['qr', 'code', 'link'] as const;
export type JoinSource = (typeof JOIN_SOURCES)[number];

export function parseJoinSource(raw: string | string[] | null | undefined): JoinSource | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (JOIN_SOURCES as readonly string[]).includes(value ?? '') ? (value as JoinSource) : null;
}

/** The in-app path a join lands on. Relative on purpose, so it works on every hostname and in
 * the WebView (see lib/appOrigin.ts). */
export function inviteJoinPath(code: string, source: JoinSource | null = null): string {
  const base = `/join/${encodeURIComponent(code)}`;
  return source ? `${base}?src=${source}` : base;
}

/** Absolute, shareable join link on the canonical origin. A phone's camera app or a pasted link
 * hands this to the OS, which opens the installed app directly if App Links / Universal Links
 * verify for `/join/*` (see the AndroidManifest intent-filter and public/.well-known/); otherwise
 * it opens straight into the browser join flow at `/join/[code]`, which works on its own now that
 * there's no mobile-browser gate in front of it. */
export function inviteUrl(code: string, source: JoinSource | null = null): string {
  return `${APP_ORIGIN}${inviteJoinPath(code, source)}`;
}

/** What the on-screen QR code encodes. */
export function inviteQrUrl(code: string): string {
  return inviteUrl(code, 'qr');
}

/** The key inside the Play install `referrer` string. Changing it silently orphans every QR
 * already scanned but not yet installed, same warning as the printed-card referrer shape. */
export const INVITE_REFERRER_KEY = 'invite_code';

/** Store links offered alongside a browser join's OpenAppPrompt nudge (see
 * components/groups/OpenAppPrompt.tsx), for anyone who doesn't have the app yet. Same shape as
 * the printed-QR redirect (app/go/[batch]/route.ts): Android carries it as a Play `referrer`,
 * which the Play Install Referrer API hands back to the app after install
 * (android/.../DeferredInvitePlugin.java); iOS has no equivalent, so its store link only carries
 * a campaign token for App Analytics and the code itself rides the pasteboard instead (see
 * OpenAppPrompt.tsx and ios/App/App/DeferredInvitePlugin.swift). */
export function inviteStoreUrls(code: string): { android: string; ios: string } {
  const referrer = encodeURIComponent(`utm_source=qr&utm_medium=invite&${INVITE_REFERRER_KEY}=${code}`);
  return {
    android: `${GOOGLE_PLAY_URL}&referrer=${referrer}`,
    ios: `${APPLE_APP_STORE_URL}?pt=qr&ct=${encodeURIComponent(`invite-${code}`)}`,
  };
}

/** Reads a code out of whatever a fresh install was handed: a Play install-referrer string
 * (`utm_source=qr&utm_medium=invite&invite_code=XXXX`), or a full invite URL off the pasteboard.
 * Null for anything else, including the printed-card referrer, which carries no code. */
export function inviteCodeFromDeferredPayload(value: string | null | undefined): string | null {
  if (!value) return null;
  const fromUrl = inviteCodeFromText(value);
  if (fromUrl) return fromUrl;
  try {
    const params = new URLSearchParams(value);
    const code = params.get(INVITE_REFERRER_KEY);
    return code ? validCode(normalizeInviteCode(code)) : null;
  } catch {
    return null;
  }
}

/**
 * Finds a `/join/XXXX` segment anywhere in a string (a bare path, a full URL, an encoded `next`
 * value) and returns the normalized code, or null when there isn't one. This is deliberately not
 * `normalizeInviteCode(text)`: run on a URL, that would happily return "HTTP" as the code.
 * The four-boxes paste handler uses this first so a pasted invite link fills the boxes correctly.
 */
export function inviteCodeFromText(text: string): string | null {
  const decoded = safeDecode(text);
  const match = /\/join\/([^/?#\s]+)/i.exec(decoded);
  if (!match) return null;
  return validCode(normalizeInviteCode(match[1]));
}

function validCode(code: string): string | null {
  return code.length === INVITE_CODE_LENGTH ? code : null;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
