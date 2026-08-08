import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/profile/AccountForms';
import { DeleteAccountButton } from '@/components/profile/DeleteAccountButton';
import { DigestToggleStub } from '@/components/profile/DigestToggleStub';
import { PushSetup } from '@/components/pwa/PushSetup';
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

      <Card className="space-y-1">
        <h2 className="mb-2 font-display font-bold text-espresso-800">Notifications &amp; app</h2>
        <DigestToggleStub />
      </Card>
      <PushSetup />
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
