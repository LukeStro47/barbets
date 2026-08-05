'use client';

import { useInstallPrompt } from '@/components/pwa/useInstallPrompt';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** Device-aware "install Barbets" instructions, shown permanently on /profile as the durable
 * place to find them again. See also InstallBanner, the dismissible nudge shown right after
 * joining/creating a group. */
export function InstallPrompt() {
  const { platform, deferredPrompt, promptInstall } = useInstallPrompt();

  if (platform === 'checking' || platform === 'installed' || platform === 'other') return null;

  return (
    <Card className="space-y-2">
      <p className="font-semibold text-espresso-800">Install Barbets</p>
      <p className="text-sm text-espresso-500">Add it to your home screen for the full app experience.</p>
      {platform === 'ios' ? (
        <ol className="ml-4 list-decimal space-y-1 text-sm text-espresso-600">
          <li>
            Tap the Share icon <span aria-hidden>􀈂</span> in Safari's toolbar
          </li>
          <li>Choose "Add to Home Screen"</li>
        </ol>
      ) : deferredPrompt ? (
        <Button size="sm" onClick={promptInstall}>
          Install app
        </Button>
      ) : (
        <ol className="ml-4 list-decimal space-y-1 text-sm text-espresso-600">
          <li>Tap the menu (⋮) in Chrome's toolbar</li>
          <li>Choose "Install app" or "Add to Home screen"</li>
        </ol>
      )}
    </Card>
  );
}
