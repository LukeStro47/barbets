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
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-[5px] text-[11.5px] font-bold text-[#8c3b2a]">
        Not saved, retry
      </button>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] text-[11.5px] font-bold text-success-700 transition-opacity duration-150',
        opaque ? 'opacity-100' : 'opacity-0'
      )}
    >
      <CheckIcon className="h-[13px] w-[13px]" />
      Saved
    </span>
  );
}
