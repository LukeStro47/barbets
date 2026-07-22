'use client';

import { Capacitor } from '@capacitor/core';
import { usePushSubscription } from '@/components/pwa/usePushSubscription';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export function PushSetup() {
  const { platform, subscribed, permission, error, isPending, subscribe, unsubscribe } = usePushSubscription();
  const isNative = Capacitor.isNativePlatform();

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
          {isNative
            ? "Notifications are blocked for Barbets. Enable them in your device's app settings, then reopen the app."
            : "Notifications are blocked for Barbets. Enable them in your browser's site settings, then reload."}
        </p>
      ) : subscribed ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-espresso-600">Notifications are on for this device.</p>
          <Button variant="outline" size="sm" disabled={isPending} onClick={unsubscribe}>
            Turn off
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-espresso-600">Get notified about markets that need you.</p>
          <Button size="sm" disabled={isPending} onClick={subscribe}>
            Enable
          </Button>
        </div>
      )}
    </Card>
  );
}
