/**
 * Where "get the app" points — shared by the printed-QR redirect (app/go/[batch]/route.ts) and
 * the mobile-browser interstitial (components/pwa/MobileAppGate.tsx).
 */

// `batch`/campaign params are appended by each caller, not baked in here, since they differ
// (a print run's batch id vs. a fixed "mobile_gate" tag) — this only owns the base destination.
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.mybarbets.app';

/** Unset until Apple's own review clears. Server-only (not NEXT_PUBLIC_): every caller that needs
 * it renders on the server and passes the resolved string down, so the env var itself never has
 * to be exposed to the client bundle. */
export function getAppleAppStoreUrl(): string | undefined {
  return process.env.APPLE_APP_STORE_URL;
}
