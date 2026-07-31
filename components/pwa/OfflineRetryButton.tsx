'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

/** Reloads automatically the instant the browser regains connectivity, with a manual button as a backstop for cases the `online` event misses (e.g. a captive portal with a live link but no real internet). */
export function OfflineRetryButton() {
  useEffect(() => {
    const handleOnline = () => window.location.reload();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return (
    <Button size="lg" className="w-full" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
