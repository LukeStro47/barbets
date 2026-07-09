'use client';

import { useEffect, useState } from 'react';
import { savePushSubscription, removePushSubscription } from '@/lib/actions/push';
import { setNotificationsEnabled } from '@/lib/actions/profile';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0))) as BufferSource;
}

type Platform = 'checking' | 'ios-needs-install' | 'unsupported' | 'ready';

export function PushSetup() {
  const [platform, setPlatform] = useState<Platform>('checking');
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
      setSubscribed(!!existing);
    });
  }, []);

  async function handleSubscribe() {
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
  }

  async function handleUnsubscribe() {
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
  }

  if (platform === 'checking') return null;

  if (platform === 'unsupported') {
    return (
      <Card>
        <p className="font-semibold text-espresso-800">Push notifications</p>
        <p className="mt-1 text-sm text-espresso-500">Push notifications aren't supported in this browser.</p>
      </Card>
    );
  }

  if (platform === 'ios-needs-install') {
    return (
      <Card className="space-y-1">
        <p className="font-semibold text-espresso-800">Get notifications on iPhone/iPad</p>
        <p className="text-sm text-espresso-500">
          Install Barbets to your home screen first (see above), iOS only allows notifications for installed apps.
          Then open it from your home screen and come back here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-2">
      <p className="font-semibold text-espresso-800">Push notifications</p>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {permission === 'denied' ? (
        <p className="text-sm text-espresso-500">
          Notifications are blocked for Barbets. Enable them in your browser's site settings, then reload.
        </p>
      ) : subscribed ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-espresso-600">Notifications are on for this device.</p>
          <Button variant="outline" size="sm" disabled={isPending} onClick={handleUnsubscribe}>
            Turn off
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-espresso-600">Get notified about markets that need you.</p>
          <Button size="sm" disabled={isPending} onClick={handleSubscribe}>
            Enable
          </Button>
        </div>
      )}
    </Card>
  );
}
