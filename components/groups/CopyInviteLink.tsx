'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

export function CopyInviteLink({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false);
  // Starts as the relative path (matches the server render, which has no
  // `window`) then upgrades to the absolute URL once mounted client-side —
  // reading window.location.origin during the initial render would mismatch
  // the server's HTML and trigger a hydration warning, same reasoning
  // CreateGroupForm's timezone state uses.
  const [url, setUrl] = useState(`/join/${inviteCode}`);
  useEffect(() => {
    setUrl(`${window.location.origin}/join/${inviteCode}`);
  }, [inviteCode]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-xl border border-espresso-200 bg-paper px-3 py-2 text-sm text-espresso-600">
        <span className="truncate">{url}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : 'Copy invite link'}
      </Button>
    </div>
  );
}
