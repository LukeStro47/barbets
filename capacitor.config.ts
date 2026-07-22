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
};

export default config;
