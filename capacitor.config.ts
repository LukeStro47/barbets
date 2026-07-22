import type { CapacitorConfig } from '@capacitor/cli';

// This app relies on Next.js Server Actions and SSR (see ARCHITECTURE.md) — it can't be bundled
// as a static export inside the native shell, so the WebView loads the real deployed app instead
// of `webDir`. `webDir` still has to point at a real folder for `cap sync` to run, but nothing in
// it is actually served once `server.url` is set.
const config: CapacitorConfig = {
  appId: 'com.mybarbets.app',
  appName: 'Barbets',
  webDir: 'public',
  server: {
    url: 'https://barbets.vercel.app',
    androidScheme: 'https',
  },
  plugins: {
    // Both platforms default to edge-to-edge (the WebView draws under the status bar with no
    // browser chrome to reserve space for it, unlike standalone Safari/Chrome) — this matches the
    // web/PWA behavior instead, which already deliberately reserves status bar space (see
    // appleWebApp.statusBarStyle: 'default' in app/layout.tsx) rather than overlaying it.
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
