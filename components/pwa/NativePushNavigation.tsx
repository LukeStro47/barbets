'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

/** Native counterpart of sw.js's 'notificationclick' handler: the send-push edge function puts the
 * same { title, body, url } shape in the FCM data payload it already sends for Web Push, so a tap
 * lands on the same target either way. Navigates via a hard location change rather than the
 * router, since a cold-start tap fires before the app's React tree (and any router context) exists
 * yet — this fires reliably regardless of what state the app was in when the notification arrived. */
export function NativePushNavigation() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      const url = (event.notification.data as { url?: string } | undefined)?.url;
      if (url) window.location.href = url;
    });
    return () => {
      listener.then((l) => l.remove());
    };
  }, []);

  return null;
}
