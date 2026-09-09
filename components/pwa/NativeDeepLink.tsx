'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { APP_ORIGIN } from '@/lib/appOrigin';

/**
 * Turns an App Link / Universal Link open into an in-app navigation. When the OS hands the
 * installed app an https://app.mybarbets.com/... URL (today only /join/* is registered for
 * that, see the AndroidManifest intent-filter and public/.well-known/), the WebView keeps
 * loading whatever it was on: Capacitor surfaces the URL as an event and leaves the rest to us.
 *
 * Two delivery paths, both handled, because they cover different app states:
 * - `appUrlOpen` fires for a warm open (the app was already running and got a new intent /
 *   user activity). It is retained until a listener consumes it, so a listener registered a
 *   beat late still gets it.
 * - `getLaunchUrl()` is the cold-start answer on Android, where the App plugin only raises
 *   `appUrlOpen` from onNewIntent and never for the intent the process was launched with.
 *   It keeps returning that same URL for the life of the process, which after the hard
 *   navigation below (a full page load, this component mounting again) would loop forever,
 *   so a sessionStorage stamp marks it consumed. sessionStorage survives the location change
 *   and dies with the process, which is exactly the lifetime of the launch intent.
 *
 * Same hard `window.location.href` as NativePushNavigation, for the same reason: this can fire
 * before any router context exists. Same-origin only: a path off some other host is not a
 * navigation this app should perform, however it got here.
 */
const LAUNCH_URL_CONSUMED_KEY = 'barbets:launchUrlConsumed';

export function NativeDeepLink() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listener = App.addListener('appUrlOpen', ({ url }) => {
      const path = inAppPath(url);
      if (path) window.location.href = path;
    });

    App.getLaunchUrl()
      .then((launch) => {
        const url = launch?.url;
        if (!url) return;
        let consumed = false;
        try {
          consumed = sessionStorage.getItem(LAUNCH_URL_CONSUMED_KEY) === url;
          sessionStorage.setItem(LAUNCH_URL_CONSUMED_KEY, url);
        } catch {
          // No sessionStorage: treat as consumed rather than risk a reload loop.
          consumed = true;
        }
        if (consumed) return;
        const path = inAppPath(url);
        if (path) window.location.href = path;
      })
      .catch(() => {});

    return () => {
      listener.then((l) => l.remove());
    };
  }, []);

  return null;
}

/** The relative path to navigate to for a URL on this app's own origin, else null. */
function inAppPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== APP_ORIGIN) return null;
    if (parsed.pathname === '/' || parsed.pathname === '') return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
