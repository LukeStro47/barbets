'use client';

import { useCallback, useEffect, useState } from 'react';
import { savePushSubscription, removePushSubscription } from '@/lib/actions/push';
import { setNotificationsEnabled } from '@/lib/actions/profile';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0))) as BufferSource;
}

export type PushPlatform = 'checking' | 'ios-needs-install' | 'unsupported' | 'ready';

/** Shared by the profile page's toggle and the app-open reminder modal, so both agree on what "subscribed" means. */
export function usePushSubscription() {
  const [platform, setPlatform] = useState<PushPlatform>('checking');
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setPending] = useState(false);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

    if (isIOS && !isStandalone) {
      setPlatform('ios-needs-install');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPlatform('unsupported');
      return;
    }

    setPlatform('ready');
    setPermission(Notification.permission);

    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      if (!existing) {
        setSubscribed(false);
        return;
      }
      // The browser can keep reporting a subscription the server has since deleted
      // (e.g. send-push's own cleanup, after a push to it came back 404/410) — re-save
      // it here so "on" always means the server actually has a row to send to.
      const json = existing.toJSON();
      const result = await savePushSubscription({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } });
      setSubscribed(!result.error);
    });
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError('Notifications were not allowed. You can change this in your browser or system settings.');
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error('Push isn’t configured yet.');

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const json = sub.toJSON();
      const result = await savePushSubscription({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } });
      if (result.error) {
        setError(result.error);
        return;
      }
      await setNotificationsEnabled(true);
      setSubscribed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enable notifications');
    } finally {
      setPending(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const result = await removePushSubscription(sub.endpoint);
        if (result.error) {
          setError(result.error);
          return;
        }
        await sub.unsubscribe();
      }
      await setNotificationsEnabled(false);
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to turn off notifications');
    } finally {
      setPending(false);
    }
  }, []);

  return { platform, subscribed, permission, error, isPending, subscribe, unsubscribe };
}
