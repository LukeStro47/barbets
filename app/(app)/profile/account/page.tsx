import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
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

      {/* Notifications are their own row in the settings block on /profile now, a sibling of this
          page rather than something nested inside it, so the link that used to sit here is gone —
          two entry points would have made "back" from that page ambiguous, and the device-level
          push toggle already lives there as its "All notifications" master. */}
      <Card className="space-y-3">
        <h2 className="font-display font-bold text-espresso-800">Digest</h2>
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
