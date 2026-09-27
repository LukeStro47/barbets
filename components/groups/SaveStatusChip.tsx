'use client';

import { useEffect, useState } from 'react';
import { CheckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Header confirmation for live-save screens. Fades in on success, holds ~2s, fades out. Errors
 * stay until the next successful save (or a tap, which retries). */
export function SaveStatusChip({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const [shown, setShown] = useState<'saved' | 'error' | null>(null);
  const [opaque, setOpaque] = useState(false);

  useEffect(() => {
    if (state === 'saved') {
      setShown('saved');
      setOpaque(true);
      const hide = window.setTimeout(() => setOpaque(false), 2000);
      const clear = window.setTimeout(() => setShown(null), 2150);
      return () => {
        window.clearTimeout(hide);
        window.clearTimeout(clear);
      };
    }
    if (state === 'error') {
      setShown('error');
      setOpaque(true);
    }
  }, [state]);

  if (!shown) return null;

  if (shown === 'error') {
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-[5px] rounded-full border border-alert-line bg-alert-bg px-2.5 py-1 text-[11px] font-bold text-alert">
        Not saved, retry
      </button>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] rounded-full border border-gain-line bg-gain-bg px-2.5 py-1 text-[11px] font-bold text-gain transition-opacity duration-150',
        opaque ? 'opacity-100' : 'opacity-0'
      )}
    >
      <CheckIcon className="h-2.5 w-2.5" />
      Saved
    </span>
  );
}
