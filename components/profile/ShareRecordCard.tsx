'use client';

import { Button } from '@/components/ui/Button';
import { ShareIcon, DownloadIcon } from '@/components/ui/icons';
import { useShareableImage } from '@/lib/shareImage';

/** Wraps the dark record card so it can be captured and shared as a PNG, same "screenshot-able
 * ticket" convention RevealTicket established. All of the capture/share mechanics live in
 * `lib/shareImage.ts`, shared with the reveal ticket. */
export function ShareRecordCard({ groupName, handle, children }: { groupName: string; handle: string; children: React.ReactNode }) {
  const { ref, status, canShare, share } = useShareableImage<HTMLDivElement>({
    filename: 'barbets-record.png',
    title: `${groupName} record`,
    text: `My record at ${groupName} (@${handle}).`,
  });

  const label =
    status === 'capturing'
      ? 'Preparing…'
      : status === 'working'
        ? 'Opening…'
        : status === 'failed'
          ? 'Try again'
          : canShare
            ? 'Share record'
            : 'Save record';

  return (
    <div>
      <div ref={ref}>{children}</div>
      <Button
        onClick={share}
        disabled={status === 'capturing' || status === 'working'}
        variant="accent"
        className="mt-3 inline-flex w-full items-center justify-center gap-2"
      >
        {canShare ? <ShareIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
        {label}
      </Button>
    </div>
  );
}
