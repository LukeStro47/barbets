/**
 * Where "get the app" points — shared by the printed-QR redirect (app/go/[batch]/route.ts) and
 * the mobile-browser interstitial (components/pwa/MobileAppGate.tsx).
 */

// `batch`/campaign params are appended by each caller, not baked in here, since they differ
// (a print run's batch id vs. a fixed "mobile_gate" tag) — this only owns the base destination.
export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.mybarbets.app';

// Both listings are live now, so there is no pending/fallback state left to gate behind an env
// var. Matches lib/stores.ts in the barbets-www project.
export const APPLE_APP_STORE_URL = 'https://apps.apple.com/us/app/barbets-bet-with-friends/id6793625147';
