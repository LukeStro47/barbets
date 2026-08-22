import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/profile/AccountForms';
import { AvatarUpload } from '@/components/profile/AvatarUpload';
import { DeleteAccountButton } from '@/components/profile/DeleteAccountButton';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

/** /profile/account — everything destructive or rarely touched, one tap deeper than the
 * per-group Profile page, in the order people go looking for it: identity, credentials,
 * notifications, deletion. Nothing here is group-scoped. */
export default async function AccountPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: userRow } = await supabase.from('users').select('avatar_updated_at').eq('id', user.id).single();

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Account & security" backHref="/profile" backLabel="Profile" />

      <Card>
        {/* No single nickname to fall back on here — this page is deliberately not group-scoped,
            and a nickname is per-membership. The email's local part stands in for the initials
            fallback only; it's never shown as text. */}
        <AvatarUpload userId={user.id} nickname={user.email?.split('@')[0] ?? '?'} avatarUpdatedAt={userRow?.avatar_updated_at ?? null} />
      </Card>

      <Card className="space-y-4">
        <ChangeEmailForm currentEmail={user?.email ?? ''} />
        <div className="border-t border-espresso-100 pt-4">
          <ChangePasswordForm />
        </div>
      </Card>

      {/* Notifications are their own row in the settings block on /profile now, a sibling of this
          page rather than something nested inside it, so the link that used to sit here is gone —
          two entry points would have made "back" from that page ambiguous, and the device-level
          push toggle already lives there as its "All notifications" master. The results-digest
          placeholder that shared this card is gone too: an always-disabled switch for a feature
          that doesn't exist costs a line of attention on every visit to advertise itself once. */}
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
