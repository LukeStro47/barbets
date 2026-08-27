'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';
import { isMobileGateExempt, isMobileBrowserUA, isIOSUA } from '@/lib/mobileGate';
import { SITE_ORIGIN } from '@/lib/appOrigin';

/**
 * A full-screen block over every page except the handful in lib/mobileGate.ts's exemption list,
 * for anyone on an ordinary phone/tablet browser — the product direction is app-only on mobile
 * now (see the removal of the browser install-to-home-screen prompts, and ARCHITECTURE.md's "PWA
 * & push"), and this is what actually enforces that instead of just no longer suggesting it.
 *
 * Entirely client-detected, deliberately: `usePathname()` is what makes this correct across a
 * client-side navigation mid-session too (an emailed reset-password link that then does
 * `router.push('/groups')` on success re-evaluates this the instant the pathname changes, no
 * stale server-computed flag to go wrong), and `Capacitor.isNativePlatform()` plus a standalone
 * `display-mode` check are the two signals that only ever exist in the browser. Starts hidden and
 * only reveals itself from an effect (same shape as the old InstallBanner/MovedBanner) so there is
 * no flash of the *wrong* thing: the brief window before this mounts shows real content rather
 * than a false block, never the other way round.
 *
 * No "continue in browser anyway" link. That absence is the point of this component, not an
 * oversight — see the exemption list's own comment for where to actually make an exception.
 *
 * No attempted deep link into an already-installed app, either: neither Universal Links (iOS) nor
 * App Links (Android) are configured (`capacitor.config.ts` has no `scheme`/associated domains),
 * so a fake `intent://`/custom-scheme attempt here would just silently fail. The one honest,
 * working thing this can offer is the store listing. Revisit once that native config plus a store
 * release ships — see the "Domains and the mybarbets.com split" section for the shape that kind of
 * rollout takes.
 */
export function MobileAppGate({
  androidStoreUrl,
  iosStoreUrl,
  enabled,
}: {
  androidStoreUrl: string;
  iosStoreUrl?: string;
  /** `isProductionDeploy()`, computed server-side in app/layout.tsx and handed down rather than
   * checked here — see that function for why it can't be read from client code directly. Off in
   * local dev and Vercel preview deploys, so testing or reviewing a mobile layout doesn't mean
   * fighting this component first. */
  enabled: boolean;
}) {
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (Capacitor.isNativePlatform()) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (isStandalone) return;

    const ua = navigator.userAgent;
    if (!isMobileBrowserUA(ua)) return;

    setIsIOS(isIOSUA(ua));
    setBlocked(true);
  }, [enabled]);

  if (!blocked || isMobileGateExempt(pathname)) return null;

  const storeUrl = isIOS ? (iosStoreUrl ?? `${SITE_ORIGIN}/download`) : androidStoreUrl;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 bg-paper px-6 py-11 text-center">
      <StackedLogo height={130} />
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-espresso-950">Continue in the app</h1>
        <p className="mt-2.5 max-w-[300px] text-[15px] leading-[1.5] text-espresso-500">
          Barbets runs in the app now, not the mobile browser. Get it free, it only takes a minute.
        </p>
      </div>
      <a href={storeUrl} className="w-full max-w-[300px]">
        <Button variant="accent" size="xl" className="w-full">
          {isIOS ? 'Get it on the App Store' : 'Get it on Google Play'}
        </Button>
      </a>
      <p className="text-[13px] text-espresso-400">Already have it? Open Barbets from your home screen instead.</p>
    </div>
  );
}
