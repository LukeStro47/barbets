import { OfflineRetryButton } from '@/components/pwa/OfflineRetryButton';
import { OfflineGroupBalances } from '@/components/pwa/OfflineGroupBalances';
import { OfflineHeadline } from '@/components/pwa/OfflineHeadline';
import { BrandTile } from '@/components/ui/BrandMark';

// Served by the service worker as the offline fallback for any failed navigation (see public/sw.js),
// so this has to render fully from the exact HTML precached at install time: no server data fetching,
// no auth check, and no next/image (its optimization endpoint is a network request the service worker
// won't have cached, so it'd render as a broken image offline). The 3ac mark is drawn as type
// (BrandTile), so there's no image to precache at all.
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-7 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
      <BrandTile size={64} className="opacity-50 grayscale" />
      <OfflineHeadline />
      <OfflineGroupBalances />
      <div className="mt-7 w-full max-w-[330px]">
        <OfflineRetryButton />
      </div>
    </main>
  );
}
