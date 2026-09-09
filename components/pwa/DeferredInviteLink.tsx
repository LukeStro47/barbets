'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { DeferredInvite } from '@/lib/deferredInvite';
import { inviteCodeFromDeferredPayload, inviteJoinPath } from '@/lib/inviteLink';

/**
 * The "deferred" half of the QR invite: someone scanned a group's QR code without the app,
 * MobileAppGate sent them to the store with the invite code attached (see lib/inviteLink.ts's
 * inviteStoreUrls), and this is what picks it back up on the first open after install and lands
 * them on /join/[code] as if the scan had opened the app directly.
 *
 * Runs once per install, ever. The localStorage stamp is written *before* the native call, so
 * a crash or a reload mid-way can never make this fire twice, and it lives in the WebView's
 * storage for app.mybarbets.com, which an uninstall wipes along with the rest of the app's
 * data. That "once" also covers every install that predates this code: the first open after
 * the web layer ships it does one check that finds no invite (the Play referrer of an
 * organic or printed-card install carries no invite_code; the iOS side only answers within a
 * day of install) and never asks again.
 *
 * Hard navigation, same as NativeDeepLink: a fresh install is sitting on the splash with no
 * session, and /join/[code] already knows how to bounce through sign-up and back.
 */
const CHECKED_KEY = 'barbets:deferredInviteChecked';

export function DeferredInviteLink() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (localStorage.getItem(CHECKED_KEY)) return;
      localStorage.setItem(CHECKED_KEY, '1');
    } catch {
      return;
    }

    DeferredInvite.read()
      .then((result) => {
        const code = inviteCodeFromDeferredPayload(result?.value);
        if (code) window.location.href = inviteJoinPath(code, 'qr');
      })
      .catch(() => {
        // UNIMPLEMENTED on a shell that predates the plugin, or the referrer service being
        // unavailable: either way there is no invite to recover, and nothing to tell anyone.
      });
  }, []);

  return null;
}
