import { OfflineRetryButton } from '@/components/pwa/OfflineRetryButton';
import { OfflineGroupBalances } from '@/components/pwa/OfflineGroupBalances';

// Served by the service worker as the offline fallback for any failed navigation (see public/sw.js),
// so this has to render fully from the exact HTML precached at install time: no server data fetching,
// no auth check, and no next/image (its optimization endpoint is a network request the service worker
// won't have cached, so it'd render as a broken image offline). Plain <img> against an already-precached
// asset instead, same reasoning RevealTicket.tsx uses for the reveal-ticket logo.
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-5 py-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] text-center">
      <img src="/barbets-lockup-tall.png" alt="Barbets" className="mx-auto mb-8 h-32 w-auto" />
      <h1 className="font-display text-3xl font-bold tracking-tight text-espresso-900">You're offline</h1>
      <p className="mt-4 max-w-sm text-lg text-espresso-500">
        Barbets needs a connection to load anything. Odds and balances change too often to show you a
        guess. Reconnect, and we'll pick back up where you left off.
      </p>
      <OfflineGroupBalances />
      <div className="mt-8 w-full max-w-xs">
        <OfflineRetryButton />
      </div>
    </main>
  );
}
