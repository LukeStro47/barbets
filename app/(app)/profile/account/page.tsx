import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/profile/AccountForms';
import { DeleteAccountButton } from '@/components/profile/DeleteAccountButton';

/** /profile/account — everything destructive or rarely touched, one tap deeper than the
 * per-group Profile page: credentials, then deletion. Nothing here is group-scoped. The profile
 * picture lived here for a while, but moved to /profile/edit so it sits next to the per-group
 * handle and each can say how far it reaches. */
export default async function AccountPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Account & security" backHref="/profile" backLabel="Profile" />

      <Card className="space-y-4">
        <ChangeEmailForm currentEmail={user?.email ?? ''} />
        <div className="border-t border-hairline pt-4">
          <ChangePasswordForm />
        </div>
      </Card>

      {/* Notifications are their own row in the settings block on /profile now, a sibling of this
          page rather than something nested inside it, so the link that used to sit here is gone —
          two entry points would have made "back" from that page ambiguous, and the device-level
          push toggle already lives there as its "All notifications" master. The results-digest
          placeholder that shared this card is gone too: an always-disabled switch for a feature
          that doesn't exist costs a line of attention on every visit to advertise itself once.
          Browser "add to home screen" instructions used to sit here too (InstallPrompt) — removed
          along with InstallBanner, see the design-decision note in "PWA & push". */}

      <Card>
        <h2 className="mb-3 font-display font-bold text-alert">Danger zone</h2>
        <p className="mb-3 text-sm leading-[1.5] text-muted">
          Deleting refunds your open bets and removes you from every group. Groups you own have to be handed over
          or deleted first.
        </p>
        <DeleteAccountButton />
      </Card>
    </main>
  );
}
