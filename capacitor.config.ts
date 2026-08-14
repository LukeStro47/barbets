import type { CapacitorConfig } from '@capacitor/cli';

// This app relies on Next.js Server Actions and SSR (see ARCHITECTURE.md) — it can't be bundled
// as a static export inside the native shell, so the WebView loads the real deployed app instead
// of `webDir` for all normal navigation. `webDir` still has to point at a real folder for `cap
// sync` to run — and now also holds one real bundled asset, `offline.html`, served locally via
// `server.errorPath` below when a load fails outright (see that comment for why).
const config: CapacitorConfig = {
  appId: 'com.mybarbets.app',
  appName: 'Barbets',
  webDir: 'public',
  server: {
    // The app's canonical origin. Changing this is a store release, not a deploy -- and it signs
    // out every existing install once, because Supabase sessions are @supabase/ssr cookies and
    // cookies are host-scoped, so a new WebView origin means an empty cookie jar. The FCM token
    // survives, so pushes keep arriving and open a logged-out app. Worth pairing with a release
    // people already want. barbets.vercel.app still serves the same deployment, so an install that
    // has not updated yet keeps working.
    url: 'https://app.mybarbets.com',
    androidScheme: 'https',
    // A failed main-frame load (offline, DNS down) has nowhere else to go: unlike a browser tab,
    // this WebView has no service worker fallback to lean on for the very first request of a cold
    // app open — Android's WebView doesn't support service-worker interception of navigation
    // requests at all, and even where it's supported (WKWebView), nothing's registered yet on a
    // fresh launch. `errorPath` is Capacitor's own native hook for this (BridgeWebViewClient on
    // Android, didFailProvisionalNavigation on iOS) — it loads a page bundled locally in `webDir`,
    // so it works with zero network, unlike everything else this app serves from server.url.
    errorPath: 'offline.html',
  },
  plugins: {
    // Both platforms default to edge-to-edge (the WebView draws under the status bar with no
    // browser chrome to reserve space for it, unlike standalone Safari/Chrome) — this matches the
    // web/PWA behavior instead, which already deliberately reserves status bar space (see
    // appleWebApp.statusBarStyle: 'default' in app/layout.tsx) rather than overlaying it.
    StatusBar: {
      overlaysWebView: false,
    },
    // Held manually (see components/pwa/BootSplash.tsx) so the native splash hands off
    // directly into the web-side animated loader instead of hiding on its own timer.
    SplashScreen: {
      launchAutoHide: false,
    },
  },
};

export default config;
