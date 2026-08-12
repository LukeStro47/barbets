'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

/**
 * The one place "turn this DOM node into a PNG and hand it to the OS share sheet" lives, shared by
 * the reveal ticket and the profile record card. Both used to roll their own copy of it and both
 * were broken in the Capacitor WebView, which has no `navigator.share` and no `navigator.canShare`
 * at all: the ticket quietly degraded to sharing a *link* instead of the image, and the record card
 * degraded to an `<a download>` the WebView ignores outright, so its button did nothing.
 */

export type ShareableImageStatus = 'capturing' | 'ready' | 'working' | 'failed';

/** Every failure path used to end in a bare `catch {}`, which meant a button that did nothing and
    a bug report nobody could act on: no console entry, no message, no way to tell a capture
    failure from a share-sheet failure. The reason is kept and surfaced instead. */
function describe(err: unknown): string {
  if (isMissingPlugin(err)) return 'Update the app from the store to share images.';
  const e = err as { name?: string; message?: string } | null;
  return e?.message || e?.name || 'Unknown error';
}

/**
 * The native shell loads the *deployed* web app (`server.url` in capacitor.config.ts), so its JS
 * is always current while its plugin layer is only as new as the last store build. Any web release
 * that reaches for a newly-added plugin therefore runs against installs that don't have it yet,
 * and Capacitor's bridge answers with an UNIMPLEMENTED rejection — which is what an installed
 * build from before `@capacitor/share`/`@capacitor/filesystem` were added does here. That's a
 * "your app is behind" situation, not a broken share, and it should say so rather than surfacing
 * `"Share" plugin is not implemented on android` to somebody who can only act on plain English.
 */
function isMissingPlugin(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === 'UNIMPLEMENTED' || e?.code === 'UNAVAILABLE') return true;
  const message = String(e?.message ?? '').toLowerCase();
  return message.includes('not implemented') || message.includes('unimplemented') || message.includes('not available');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('could not read image'));
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** A dismissed share sheet is a normal outcome, not a failure — every platform reports it differently. */
function isDismissal(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'AbortError') return true;
  const message = String(e?.message ?? '').toLowerCase();
  return message.includes('cancel') || message.includes('abort') || message.includes('dismiss');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Anchored in the document and revoked late on purpose: a detached anchor is ignored by some
  // browsers, and revoking the object URL on the line after click() can cancel the save before it
  // has started.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function shareImageBlob(blob: Blob, { filename, title, text }: { filename: string; title: string; text: string }) {
  if (Capacitor.isNativePlatform()) {
    // Writing the PNG into the app's own cache and handing the Share plugin its file:// URI is the
    // only route to the system share sheet with the image actually attached. The fixed filename is
    // deliberate: each share overwrites the last instead of growing the cache directory forever.
    const base64 = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    try {
      await Share.share({ title, text, files: [uri] });
    } catch (err) {
      if (!isDismissal(err)) throw err;
    }
    return;
  }

  const file = new File([blob], filename, { type: 'image/png' });
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return;
    } catch (err) {
      if (isDismissal(err)) return;
      // Anything else and the browser claimed it could share files but couldn't — save instead.
    }
  }

  downloadBlob(blob, filename);
}

export interface ShareableImageOptions {
  /** Also the name the PNG is saved/attached under. */
  filename: string;
  title: string;
  text: string;
  /** Capture waits for this. The reveal ticket holds it shut until its tear animation has settled. */
  ready?: boolean;
}

/**
 * Attach `ref` to the node you want captured. The PNG is rendered eagerly as soon as `ready` turns
 * true rather than on the click: `toBlob` is async, and an await between a tap and
 * `navigator.share()` loses the user activation Safari requires for its share sheet.
 */
export function useShareableImage<T extends HTMLElement>({ filename, title, text, ready = true }: ShareableImageOptions) {
  const ref = useRef<T>(null);
  const blobRef = useRef<Blob | null>(null);
  const [status, setStatus] = useState<ShareableImageStatus>('capturing');
  const [reason, setReason] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      setCanShare(true);
      return;
    }
    try {
      const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
      setCanShare(
        typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
      );
    } catch {
      setCanShare(false);
    }
  }, []);

  const capture = useCallback(async () => {
    const node = ref.current;
    if (!node) return null;
    await document.fonts.ready;
    const result = await toBlob(node, { pixelRatio: 2, cacheBust: true });
    // toBlob resolves to null rather than throwing when the canvas refuses to export.
    if (!result) throw new Error('capture produced no image');
    blobRef.current = result;
    return result;
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setStatus('capturing');
    setReason(null);
    capture()
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[shareImage] capture failed', err);
        setReason(describe(err));
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [ready, capture]);

  const share = useCallback(async () => {
    let blob = blobRef.current;
    if (blob) {
      // No await before this call, so the click's user activation still stands.
      setStatus('working');
      try {
        await shareImageBlob(blob, { filename, title, text });
        setStatus('ready');
      } catch (err) {
        console.error('[shareImage] share failed', err);
        setReason(describe(err));
        setStatus('failed');
      }
      return;
    }

    // The eager capture failed. Retrying here is what keeps the button from being a dead control,
    // which is exactly how it read before: no image, no error, nothing happens on tap.
    setStatus('working');
    try {
      blob = await capture();
    } catch (err) {
      console.error('[shareImage] retry capture failed', err);
      setReason(describe(err));
      blob = null;
    }
    if (!blob) {
      setStatus('failed');
      return;
    }
    try {
      await shareImageBlob(blob, { filename, title, text });
      setStatus('ready');
    } catch (err) {
      console.error('[shareImage] share failed', err);
      setReason(describe(err));
      setStatus('failed');
    }
  }, [capture, filename, title, text]);

  return { ref, status, reason, canShare, share };
}
