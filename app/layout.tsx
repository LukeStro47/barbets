import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
});

export const metadata: Metadata = {
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolage.variable}>
      <body className="font-sans antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
