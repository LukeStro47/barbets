import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker';
import { NativePushNavigation } from '@/components/pwa/NativePushNavigation';
import { NativeBackButton } from '@/components/pwa/NativeBackButton';
import { BootSplash } from '@/components/pwa/BootSplash';
import { ChunkErrorRecovery } from '@/components/pwa/ChunkErrorRecovery';
import { MovedBanner } from '@/components/pwa/MovedBanner';
import { MobileAppGate } from '@/components/pwa/MobileAppGate';
import { APP_ORIGIN } from '@/lib/appOrigin';
import { GOOGLE_PLAY_URL, APPLE_APP_STORE_URL } from '@/lib/appStores';
import { isProductionDeploy } from '@/lib/mobileGate';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
});

export const metadata: Metadata = {
  // This app answers on three hostnames (app.mybarbets.com, the barbets.vercel.app deployment
  // alias, and localhost), so relative metadata URLs need an explicit base rather than whichever
  // one Next infers. mybarbets.com is deliberately not it: that domain is the marketing site now,
  // and it owns its own canonical URLs.
  metadataBase: new URL(APP_ORIGIN),
  title: 'Barbets',
  description: 'Private prediction markets for your friend group.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Barbets',
  },
};

export const viewport: Viewport = {
  themeColor: '#3B2A20',
  // Capacitor's native WebView renders edge-to-edge behind the status bar/notch by default, with
  // no browser chrome to auto-inset content the way standalone Safari/Chrome already do — without
  // viewport-fit=cover, the env(safe-area-inset-*) values BetslipBar and friends already lean on
  // just read as 0 there, and content sits under the status bar / home indicator.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  // This app has plenty of inputs styled under the 16px iOS treats as "safe" (compact settings
  // fields, inline editors), and WKWebView zooms the page in to legible size the moment one of
  // those takes focus, the same as Mobile Safari. maximumScale/userScalable below is what actually
  // suppresses that, at the viewport level, rather than auditing every input's font size app-wide.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body className="font-sans antialiased">
        {/* Mounted first and unconditionally so it's listening before anything else has a chance
            to throw a stale-chunk error - see the component. */}
        <ChunkErrorRecovery />
        {/* Above {children} so it sits at the very top of every screen, signed in or not. Renders
            nothing unless the page was served from mybarbets.com — see the component. */}
        <MovedBanner />
        {/* Renders nothing until its own client-side checks confirm an ordinary mobile browser
            tab — see the component for why the store URLs are resolved here and handed down
            rather than read client-side. */}
        <MobileAppGate androidStoreUrl={GOOGLE_PLAY_URL} iosStoreUrl={APPLE_APP_STORE_URL} enabled={isProductionDeploy()} />
        {children}
        <RegisterServiceWorker />
        <NativePushNavigation />
        <NativeBackButton />
        <BootSplash />
      </body>
    </html>
  );
}
