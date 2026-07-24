'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Android hardware/gesture back button: Capacitor's BridgeActivity doesn't
 * check WebView history on its own, so without this, back always exits the
 * app instead of navigating within the SPA's own (real, pushState-backed)
 * history. Mirrors the browser back button's own semantics: go back if
 * there's somewhere to go, otherwise let the app exit.
 */
export function NativeBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.exitApp();
      }
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);

  return null;
}
