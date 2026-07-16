'use client';

import { useState } from 'react';
import { getResolutionProofUrl } from '@/lib/actions/resolution';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CameraIcon } from '@/components/ui/icons';

/**
 * Fetches the signed photo URL lazily on click rather than eagerly on
 * render — the reveal page and market detail page render for every viewer
 * on every load, and most proposals have no photo at all; there's no reason
 * to mint (or even check for) a signed URL until someone actually asks.
 */
export function ResolutionProofButton({ marketId, variant }: { marketId: string; variant: 'action' | 'icon' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    const result = await getResolutionProofUrl(marketId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setUrl(result.data!);
    }
  }

  function close() {
    setUrl(null);
    setError(null);
  }

  return (
    <>
      {variant === 'action' ? (
        <Button onClick={open} disabled={loading} variant="outline" className="inline-flex items-center justify-center gap-2">
          <CameraIcon className="h-4 w-4" />
          {loading ? 'Loading…' : 'Proof'}
        </Button>
      ) : (
        <button
          type="button"
          onClick={open}
          disabled={loading}
          aria-label="View proof photo"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-paper-white text-espresso-500 shadow-sm hover:text-espresso-800 disabled:opacity-50"
        >
          <CameraIcon className="h-3.5 w-3.5" />
        </button>
      )}

      {(url || error) && (
        <Modal onClose={close}>
          {url ? (
            <>
              <p className="font-display font-bold text-espresso-900">Proof photo</p>
              <img src={url} alt="Resolution proof" className="max-h-[70vh] w-full rounded-xl object-contain" />
            </>
          ) : (
            <>
              <p className="font-display font-bold text-espresso-900">Couldn't load photo</p>
              <p className="text-sm text-espresso-500">{error}</p>
            </>
          )}
          <Button className="w-full" onClick={close}>
            Close
          </Button>
        </Modal>
      )}
    </>
  );
}
