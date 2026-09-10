'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { isIOSUA } from '@/lib/mobileBrowser';
import { inviteStoreUrls, inviteUrl } from '@/lib/inviteLink';

/**
 * Shown by JoinFlow right after a successful browser join, in place of the old hard
 * MobileAppGate — there's no gate any more, so a browser join always finishes and lands
 * someone in their new group; this is a one-time nudge, not a wall, with its own "continue
 * in browser" escape hatch. Only rendered for a mobile browser tab (JoinFlow's own
 * Capacitor/standalone/UA check), never inside the native app or an installed PWA.
 *
 * Store links carry the invite code through the install the same way the old gate's did
 * (Play `referrer` on Android, clipboard on iOS, both via lib/inviteLink.ts), for anyone who
 * doesn't yet have the app that carries App Links support - but since the join already
 * happened here in the browser, the group itself doesn't depend on any of this working.
 */
export function OpenAppPrompt({
  groupName,
  inviteCode,
  onContinueInBrowser,
}: {
  groupName: string;
  inviteCode: string;
  onContinueInBrowser: () => void;
}) {
  const [isIOS, setIsIOS] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    setIsIOS(isIOSUA(navigator.userAgent));
  }, []);

  const link = inviteUrl(inviteCode, 'link');
  const inviteUrls = inviteStoreUrls(inviteCode);
  const stores = [
    { url: inviteUrls.ios, label: 'Get it on the App Store' },
    { url: inviteUrls.android, label: 'Get it on Google Play' },
  ];
  const [primary, secondary] = isIOS ? stores : [stores[1], stores[0]];

  // Best-effort, inside the tap that leaves for the store: the clipboard is what carries the
  // invite through an iOS install, same reasoning as the old MobileAppGate.
  function copyInviteForInstall() {
    navigator.clipboard?.writeText(link).catch(() => {});
  }

  function copy(kind: 'link' | 'code', value: string) {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(kind);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => {});
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
      <StackedLogo height={110} />
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-espresso-950">You're in {groupName}</h1>
        <p className="mt-2.5 max-w-[300px] text-[15px] leading-[1.5] text-espresso-500">
          Barbets works best in the app, push notifications when a bet closes, faster loads. Get it free, your group carries
          over automatically.
        </p>
      </div>
      <div className="flex w-full max-w-[300px] flex-col gap-2.5">
        <a href={primary.url} onClick={copyInviteForInstall}>
          <Button variant="accent" size="xl" className="w-full">
            {primary.label}
          </Button>
        </a>
        <a href={secondary.url} onClick={copyInviteForInstall}>
          <Button variant="outline" size="xl" className="w-full">
            {secondary.label}
          </Button>
        </a>
      </div>
      <div className="w-full max-w-[300px] space-y-3 rounded-2xl border border-espresso-100 bg-paper-white px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-espresso-500">{link}</span>
          <button type="button" onClick={() => copy('link', link)} className="shrink-0 text-[13px] font-bold text-honey-700">
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-espresso-100 pt-3">
          <span className="font-display text-lg font-extrabold tracking-[0.2em] text-espresso-900">{inviteCode}</span>
          <button type="button" onClick={() => copy('code', inviteCode)} className="shrink-0 text-[13px] font-bold text-honey-700">
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
        </div>
      </div>
      <button type="button" onClick={onContinueInBrowser} className="text-sm text-espresso-500 hover:text-espresso-800">
        Continue in browser instead →
      </button>
    </div>
  );
}
