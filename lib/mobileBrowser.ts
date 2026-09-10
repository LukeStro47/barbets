/** Phone/tablet browser detection, shared by anything that needs to tell a mobile browser tab
 * apart from the native app or pick which app store leads. There is no hard access gate here any
 * more (see the "mobile-browser gate" removal in ARCHITECTURE.md) — this is now just UA sniffing. */

const MOBILE_UA_RE = /android|iphone|ipad|ipod/i;

/**
 * A phone/tablet's own browser. Deliberately not how anything tells the native app apart from a
 * browser tab — that's `Capacitor.isNativePlatform()`, a real bridge check present in every
 * native build regardless of app version, unlike the `appendUserAgent` marker
 * `lib/actions/auth.ts` uses for its own, unrelated, server-side check (no equivalent bridge
 * object to lean on there instead).
 */
export function isMobileBrowserUA(userAgent: string): boolean {
  return MOBILE_UA_RE.test(userAgent);
}

export function isIOSUA(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}
