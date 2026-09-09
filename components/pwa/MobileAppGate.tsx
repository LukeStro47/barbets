'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';
import { isMobileGateExempt, isMobileBrowserUA, isIOSUA } from '@/lib/mobileGate';
import { inviteCodeFromLocation, inviteQrUrl, inviteStoreUrls } from '@/lib/inviteLink';

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
 * No attempted deep link into an already-installed app from here, either. App Links (Android) and
 * Universal Links (iOS) are registered for `/join/*` only (AndroidManifest.xml, App.entitlements,
 * public/.well-known/), and when they verify the OS opens the installed app *before* the browser
 * ever loads this page, so by the time this gate renders the app is, as far as anyone can tell,
 * not installed. A fake `intent://`/custom-scheme attempt would just silently fail. The one honest,
 * working thing this can offer is the store listing.
 *
 * With one refinement when the page it's covering is an invite (`/join/[code]`, or the
 * `/login?next=/join/...` bounce a signed-out visitor lands on first): the store links carry the
 * invite code through the install, so a scanned group QR code still ends in a join rather than a
 * dead end. Android gets it as a Play `referrer` the app reads back after install; iOS has no
 * such channel, so the tap also copies the invite URL to the clipboard for the app to find on
 * first open (see lib/inviteLink.ts and components/pwa/DeferredInviteLink.tsx). The code itself
 * is shown as well, since typing four characters is the fallback that never fails.
 *
 * Both store buttons render, always, rather than just the detected platform's. `isIOSUA()` still
 * decides which one leads (accent, on top) and which trails (outline, below) — worth keeping
 * since the detection is usually right and a matching first button is a shorter path for most
 * visitors — but showing only one meant a false negative (or someone on a device this component
 * doesn't recognize) had no way to reach the store they actually needed.
 */
export function MobileAppGate({
  androidStoreUrl,
  iosStoreUrl,
  enabled,
}: {
  androidStoreUrl: string;
  iosStoreUrl: string;
  /** `isProductionDeploy()`, computed server-side in app/layout.tsx and handed down rather than
   * checked here — see that function for why it can't be read from client code directly. Off in
   * local dev and Vercel preview deploys, so testing or reviewing a mobile layout doesn't mean
   * fighting this component first. */
  enabled: boolean;
}) {
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

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

  // Re-read on every pathname change, not just once: the search string isn't part of
  // usePathname(), and reading window.location here (an effect, never during render) keeps
  // this component free of useSearchParams and the Suspense boundary it would demand of the
  // root layout.
  useEffect(() => {
    setInviteCode(inviteCodeFromLocation(pathname, window.location.search));
  }, [pathname]);

  if (!blocked || isMobileGateExempt(pathname)) return null;

  const inviteUrls = inviteCode ? inviteStoreUrls(inviteCode) : null;
  const stores = [
    { url: inviteUrls?.ios ?? iosStoreUrl, label: 'Get it on the App Store' },
    { url: inviteUrls?.android ?? androidStoreUrl, label: 'Get it on Google Play' },
  ];
  // Best-effort, inside the tap that leaves for the store: the clipboard is what carries the
  // invite through an iOS install, and a clipboard write outside a user gesture is refused.
  const copyInviteForInstall = () => {
    if (!inviteCode) return;
    navigator.clipboard?.writeText(inviteQrUrl(inviteCode)).catch(() => {});
  };
  // Detected platform's store leads; the other trails as a fallback for a wrong guess or a
  // device isIOSUA()/isMobileBrowserUA() doesn't recognize.
  const [primary, secondary] = isIOS ? stores : [stores[1], stores[0]];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 bg-paper px-6 py-11 text-center">
      <StackedLogo height={130} />
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-espresso-950">Continue in the app</h1>
        <p className="mt-2.5 max-w-[300px] text-[15px] leading-[1.5] text-espresso-500">
          {inviteCode
            ? 'Barbets runs in the app, not the mobile browser. Get it free and your invite comes with you.'
            : 'Barbets runs in the app now, not the mobile browser. Get it free, it only takes a minute.'}
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
      {inviteCode ? (
        <div className="max-w-[300px]">
          <p className="text-[13px] text-espresso-400">If the app doesn&apos;t take you straight to the group, your invite code is</p>
          <p className="mt-1 font-display text-2xl font-extrabold tracking-[0.2em] text-espresso-900">{inviteCode}</p>
        </div>
      ) : (
        <p className="text-[13px] text-espresso-400">Already have it? Open Barbets from your home screen instead.</p>
      )}
    </div>
  );
}
