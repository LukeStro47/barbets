'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { QrCodeIcon } from '@/components/ui/icons';
import { inviteQrUrl } from '@/lib/inviteLink';

/**
 * The balance card's second pill, next to InvitePill: puts the invite link on screen as a QR code,
 * full-bleed and white, so a friend across the table points their camera at it and lands on
 * /join/[code] with no typing and nothing sent. The URL it encodes is inviteQrUrl(): the real
 * app.mybarbets.com join link tagged `?src=qr`, which is how join_group later records that this
 * join came from a scan rather than a typed code.
 *
 * Rendered client-side from the `qrcode` package into a data URL, so nothing about the code
 * leaves the device to make the picture. Not a Modal: the point is maximum contrast and size,
 * and a centered dialog with a dimmed backdrop is the opposite of that, so this is its own
 * portal with a pure white ground, the QR sized to the shorter viewport edge, and a
 * best-effort screen wake lock so the display doesn't dim halfway through a round of scans.
 */
export function InviteQrButton({ inviteCode, groupName }: { inviteCode: string; groupName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.09] px-[11px] py-[5px] text-xs font-bold text-honey-200"
      >
        <QrCodeIcon className="h-3 w-3" />
        Show QR
      </button>
      {open && <InviteQrScreen inviteCode={inviteCode} groupName={groupName} onClose={() => setOpen(false)} />}
    </>
  );
}

function InviteQrScreen({ inviteCode, groupName, onClose }: { inviteCode: string; groupName: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Medium error correction: plenty for a clean screen render, and the smaller module count
    // it buys is what makes the code scan from across a table rather than only up close.
    QRCode.toDataURL(inviteQrUrl(inviteCode), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 1024,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  // Same body scroll lock as Modal, for the same reason: the overlay covers the page visually
  // but not for touch, and a drag here would scroll the hub underneath.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Keep the screen on while this is up. Unsupported (WKWebView) or denied just means the usual
  // auto-dim, so every failure path is swallowed on purpose.
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } })
      .wakeLock;
    wakeLock
      ?.request('screen')
      .then((s) => {
        sentinel = s;
      })
      .catch(() => {});
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center bg-white px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-center">
      <p className="text-xs font-bold tracking-[2px] text-espresso-500 uppercase">Scan to join</p>
      <p className="mt-1.5 max-w-full truncate font-display text-xl font-extrabold tracking-[-0.02em] text-espresso-950">{groupName}</p>

      <div className="flex min-h-0 flex-1 items-center justify-center py-5">
        <div className="aspect-square w-[min(100vw-3rem,60vh)] max-w-[420px]">
          {dataUrl ? (
            // A plain <img> on a data URL: nothing to fetch, nothing for next/image to optimize,
            // and it stays crisp at any size because the source is rendered at 1024px.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt={`QR code for invite ${inviteCode}`} className="h-full w-full" draggable={false} />
          ) : failed ? (
            <p className="flex h-full items-center justify-center text-sm text-espresso-500">
              Couldn&apos;t draw the code. Share the invite code below instead.
            </p>
          ) : (
            <div className="h-full w-full animate-pulse rounded-2xl bg-espresso-50" />
          )}
        </div>
      </div>

      <p className="text-[13px] text-espresso-500">Point a phone camera at it. Or type the code:</p>
      <p className="mt-1 font-display text-3xl font-extrabold tracking-[0.2em] text-espresso-950">{inviteCode}</p>

      <Button variant="outline" size="lg" className="mt-6 w-full max-w-[300px]" onClick={onClose}>
        Done
      </Button>
    </div>,
    document.body
  );
}
