'use client';

import { useEffect, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import { Button } from '@/components/ui/Button';
import { ShareIcon, DownloadIcon } from '@/components/ui/icons';

/** Wraps the dark record card so it can be captured and shared as a PNG, same "screenshot-able
 * ticket" convention RevealTicket established. Captured eagerly on mount (not lazily on click) —
 * an await between a click and navigator.share() risks losing the user-activation Safari
 * requires for its native share sheet. */
export function ShareRecordCard({ groupName, handle, children }: { groupName: string; handle: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [capturing, setCapturing] = useState(true);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    try {
      const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
      setCanShareFiles(
        typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
      );
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    document.fonts.ready
      .then(() => toBlob(node, { pixelRatio: 2, cacheBust: true }))
      .then((result) => {
        if (!cancelled) {
          setBlob(result);
          setCapturing(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCapturing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function downloadBlob(b: Blob) {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'barbets-record.png';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleShare() {
    if (!blob) return;
    const file = new File([blob], 'barbets-record.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: `${groupName} record`, text: `My record at ${groupName} (@${handle}).` });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') downloadBlob(blob);
    }
  }

  return (
    <div>
      <div ref={ref}>{children}</div>
      <Button
        onClick={canShareFiles ? handleShare : () => blob && downloadBlob(blob)}
        disabled={capturing}
        variant="accent"
        className="mt-3 inline-flex w-full items-center justify-center gap-2"
      >
        {canShareFiles ? <ShareIcon className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
        {capturing ? 'Preparing…' : canShareFiles ? 'Share record' : 'Save record'}
      </Button>
    </div>
  );
}
