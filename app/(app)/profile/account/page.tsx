import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { ChevronRightIcon } from '@/components/ui/icons';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/profile/AccountForms';
import { DeleteAccountButton } from '@/components/profile/DeleteAccountButton';
import { DigestToggleStub } from '@/components/profile/DigestToggleStub';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

/** /profile/account — everything destructive or rarely touched, one tap deeper than the
 * per-group Profile page, in the order people go looking for it: identity, credentials,
 * notifications, deletion. Nothing here is group-scoped. */
export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Account & security" backHref="/profile" backLabel="Profile" />

      <Card className="space-y-4">
        <ChangeEmailForm currentEmail={user?.email ?? ''} />
        <div className="border-t border-espresso-100 pt-4">
          <ChangePasswordForm />
        </div>
      </Card>

      {/* PushSetup itself moved to /profile/notifications, where the rest of the push preferences
          now live — keeping it here too would give the device toggle two homes that could show
          different states. */}
      <Card className="space-y-3">
        <h2 className="font-display font-bold text-espresso-800">Notifications &amp; app</h2>
        <Link
          href="/profile/notifications"
          className="flex items-center gap-3 rounded-2xl border border-espresso-100 px-4 py-3 transition-colors hover:bg-espresso-50/40"
        >
          <span className="flex-1">
            <p className="text-sm font-semibold text-espresso-800">Notification settings</p>
            <p className="text-xs text-espresso-400">Choose what each group can ping you about, plus nudges and news.</p>
          </span>
          <ChevronRightIcon className="h-4 w-3 shrink-0 text-espresso-300" />
        </Link>
        <DigestToggleStub />
      </Card>
      <InstallPrompt />

      <Card>
        <h2 className="mb-3 font-display font-bold text-danger-700">Danger zone</h2>
        <p className="mb-3 text-sm leading-[1.5] text-espresso-500">
          Deleting refunds your open bets and removes you from every group. Groups you own have to be handed over
          or deleted first.
        </p>
        <DeleteAccountButton />
      </Card>
    </main>
  );
}
