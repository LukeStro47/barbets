import { registerPlugin } from '@capacitor/core';

/**
 * JS side of the two tiny native plugins that let an invite survive an app-store install
 * (android/app/src/main/java/com/mybarbets/app/DeferredInvitePlugin.java and
 * ios/App/App/DeferredInvitePlugin.swift). One method, one string back, and the platforms
 * disagree about what that string is:
 *
 * - Android returns the raw Play install `referrer` (the Play Install Referrer API), which the
 *   store link built by lib/inviteLink.ts's inviteStoreUrls() carries as
 *   `utm_source=qr&utm_medium=invite&invite_code=XXXX`.
 * - iOS has no install referrer at all, so it returns the pasteboard's contents, only if the
 *   pasteboard looks like it holds a web URL and only within the first day after install.
 *   MobileAppGate copies the invite URL there when someone taps through to the App Store.
 *
 * lib/inviteLink.ts's inviteCodeFromDeferredPayload() reads a code out of either shape, so the
 * caller (components/pwa/DeferredInviteLink.tsx) never has to know which platform answered.
 *
 * An install whose native shell predates this plugin rejects with UNIMPLEMENTED, same as any
 * plugin added after a store release (see "The native shells run current JS against a plugin
 * layer that can be months old" under "PWA & push" in ARCHITECTURE.md). That is the expected
 * answer for every existing install until the next release, not an error worth surfacing.
 */
export interface DeferredInvitePlugin {
  read(): Promise<{ value?: string | null }>;
}

export const DeferredInvite = registerPlugin<DeferredInvitePlugin>('DeferredInvite');
