import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker';
import { NativePushNavigation } from '@/components/pwa/NativePushNavigation';
import { NativeBackButton } from '@/components/pwa/NativeBackButton';
import { BootSplash } from '@/components/pwa/BootSplash';
import { MovedBanner } from '@/components/pwa/MovedBanner';
import { APP_ORIGIN } from '@/lib/appOrigin';

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body className="font-sans antialiased">
        {/* Above {children} so it sits at the very top of every screen, signed in or not. Renders
            nothing unless the page was served from mybarbets.com — see the component. */}
        <MovedBanner />
        {children}
        <RegisterServiceWorker />
        <NativePushNavigation />
        <NativeBackButton />
        <BootSplash />
      </body>
    </html>
  );
}
