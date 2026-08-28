/** Pure logic behind components/pwa/MobileAppGate.tsx, kept separate so the exemption list and
 * platform check are each one obvious place to read/edit rather than buried in JSX. */

const MOBILE_UA_RE = /android|iphone|ipad|ipod/i;

/**
 * Routes an emailed Supabase Auth link can land on, which have to keep working wherever they're
 * tapped — the recipient doesn't necessarily have the app yet, and there's no "hand off to the
 * app" equivalent for a one-time token link until Universal/App Links exist (a real native
 * config + store release, not a page like this one). `/offline` is the one addition beyond auth:
 * it's the service worker's own fallback for a failed navigation, not a page anyone taps into on
 * purpose, and stacking a screen that needs the app store on top of one that means there wasn't
 * any connectivity helps nobody.
 *
 * `/privacy` and `/terms` are exempt for the same "has to work wherever it's tapped" reason, not
 * because anyone types them into a phone browser on purpose: mybarbets.com's marketing site links
 * to these two pages instead of hosting its own copy of the text (see app/privacy/page.tsx and
 * app/terms/page.tsx), and App Store Connect/Google Play/Apple's own review both link to a privacy
 * policy URL directly. A legal document has to actually render for whoever follows that link, gate
 * or no gate — blocking it behind "get the app" would mean the one copy of the policy that exists
 * is unreadable from the exact places required to link to it.
 *
 * Everything else — including `/`, `/login`, `/join/[code]`, and every signed-in page — is gated.
 * That is a deliberate, hard product decision: there is no "continue in browser anyway" escape
 * hatch here, unlike a normal confirmation modal. Reconsider this list, not the gate itself, if a
 * route needs to keep working outside the app.
 */
const EXEMPT_PATHS = [
  /^\/forgot-password\/?$/,
  /^\/reset-password\/?$/,
  /^\/offline\/?$/,
  /^\/privacy\/?$/,
  /^\/terms\/?$/,
];

export function isMobileGateExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((re) => re.test(pathname));
}

/**
 * A phone/tablet's own browser. Deliberately not how MobileAppGate tells the native app apart —
 * that's `Capacitor.isNativePlatform()`, a real bridge check present in every native build
 * regardless of app version, unlike the `appendUserAgent` marker `lib/actions/auth.ts` uses for
 * its own, unrelated, server-side check (no equivalent bridge object to lean on there instead).
 */
export function isMobileBrowserUA(userAgent: string): boolean {
  return MOBILE_UA_RE.test(userAgent);
}

export function isIOSUA(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

/**
 * Server-only — reads `process.env.VERCEL_ENV`, which is not exposed to the client bundle (it
 * isn't `NEXT_PUBLIC_`-prefixed), so this must be called from app/layout.tsx and its result
 * handed down as a prop, never imported and called from MobileAppGate itself. Same reasoning as
 * lib/actions/auth.ts's own `IS_PRODUCTION`: `NODE_ENV` alone reads 'production' for a preview
 * deploy too, which would gate PR-review traffic along with the real thing. Local dev and preview
 * deploys stay ungated so testing/reviewing a mobile layout doesn't mean fighting this component.
 */
export function isProductionDeploy(): boolean {
  return process.env.VERCEL_ENV ? process.env.VERCEL_ENV === 'production' : process.env.NODE_ENV === 'production';
}
