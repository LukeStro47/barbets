import { OfflineRetryButton } from '@/components/pwa/OfflineRetryButton';
import { OfflineGroupBalances } from '@/components/pwa/OfflineGroupBalances';
import { OfflineHeadline } from '@/components/pwa/OfflineHeadline';

// Served by the service worker as the offline fallback for any failed navigation (see public/sw.js),
// so this has to render fully from the exact HTML precached at install time: no server data fetching,
// no auth check, and no next/image (its optimization endpoint is a network request the service worker
// won't have cached, so it'd render as a broken image offline). Plain <img> against an already-precached
// asset instead, same reasoning RevealTicket.tsx uses for the reveal-ticket logo.
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-7 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
      <img src="/barbets-coin.png" alt="" className="h-24 w-auto opacity-50 grayscale" />
      <OfflineHeadline />
      <OfflineGroupBalances />
      <div className="mt-7 w-full max-w-[330px]">
        <OfflineRetryButton />
      </div>
    </main>
  );
}
