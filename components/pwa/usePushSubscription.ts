'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { savePushSubscription, removePushSubscription, saveNativePushSubscription, removeNativePushSubscription } from '@/lib/actions/push';
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
  // The current FCM token, so unsubscribe() and the tokenReceived refresh listener know which row
  // to touch — there's no "getCurrentSubscription()" native equivalent to re-derive it from later.
  const nativeTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      setPlatform('ready');
      FirebaseMessaging.checkPermissions().then(async ({ receive }) => {
        setPermission(receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'default');
        if (receive !== 'granted') {
          setSubscribed(false);
          return;
        }
        // Same reasoning as the web path below: re-save on every mount so "on" always means the
        // server actually has a row to send to, not just that the OS still remembers permission.
        const { token } = await FirebaseMessaging.getToken();
        nativeTokenRef.current = token;
        const result = await saveNativePushSubscription(token, Capacitor.getPlatform() as 'android' | 'ios');
        setSubscribed(!result.error);
      });

      const listener = FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
        nativeTokenRef.current = token;
        if (subscribed) await saveNativePushSubscription(token, Capacitor.getPlatform() as 'android' | 'ios');
      });
      return () => {
        listener.then((l) => l.remove());
      };
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeNative = useCallback(async () => {
    const { receive } = await FirebaseMessaging.requestPermissions();
    setPermission(receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'default');
    if (receive !== 'granted') {
      setError('Notifications were not allowed. You can change this in your device settings.');
      return;
    }

    const { token } = await FirebaseMessaging.getToken();
    nativeTokenRef.current = token;
    const result = await saveNativePushSubscription(token, Capacitor.getPlatform() as 'android' | 'ios');
    if (result.error) {
      setError(result.error);
      return;
    }
    await setNotificationsEnabled(true);
    setSubscribed(true);
  }, []);

  const unsubscribeNative = useCallback(async () => {
    const token = nativeTokenRef.current ?? (await FirebaseMessaging.getToken()).token;
    const result = await removeNativePushSubscription(token);
    if (result.error) {
      setError(result.error);
      return;
    }
    await FirebaseMessaging.deleteToken();
    nativeTokenRef.current = null;
    await setNotificationsEnabled(false);
    setSubscribed(false);
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      if (Capacitor.isNativePlatform()) {
        await subscribeNative();
        return;
      }

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
  }, [subscribeNative]);

  const unsubscribe = useCallback(async () => {
    setError(null);
    setPending(true);
    try {
      if (Capacitor.isNativePlatform()) {
        await unsubscribeNative();
        return;
      }

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
  }, [unsubscribeNative]);

  return { platform, subscribed, permission, error, isPending, subscribe, unsubscribe };
}
