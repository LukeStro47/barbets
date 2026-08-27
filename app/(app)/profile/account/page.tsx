import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/profile/AccountForms';
import { DeleteAccountButton } from '@/components/profile/DeleteAccountButton';
import { AvatarPicker } from '@/components/profile/AvatarPicker';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { ChevronRightIcon } from '@/components/ui/icons';

/** /profile/account — everything destructive or rarely touched, one tap deeper than the
 * per-group Profile page, in the order people go looking for it: identity, credentials, profile
 * picture, notifications, deletion. Nothing here is group-scoped. The profile picture used to live
 * on the main /profile page instead (identity, not account hygiene, was the reasoning) but moved
 * here to keep everything about the account itself in one place. */
export default async function AccountPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [{ data: avatarRow }, { data: firstMembership }] = await Promise.all([
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', user.id).single(),
    supabase.from('memberships').select('nickname').eq('user_id', user.id).neq('status', 'removed').limit(1).maybeSingle(),
  ]);
  const nickname = firstMembership?.nickname ?? user.email?.split('@')[0] ?? '?';

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Account & security" backHref="/profile" backLabel="Profile" />

      <AvatarPicker
        userId={user.id}
        nickname={nickname}
        avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
        avatarPresetKey={avatarRow?.avatar_preset_key ?? null}
        trigger={
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-[20px] border border-espresso-100 bg-paper-white px-4 py-3.5 transition-colors hover:border-espresso-200"
          >
            <UserAvatar
              userId={user.id}
              nickname={nickname}
              avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
              avatarPresetKey={avatarRow?.avatar_preset_key ?? null}
              className="h-9 w-9 shrink-0 text-xs"
              fallbackClassName="bg-espresso-50 text-honey-700"
            />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-extrabold text-espresso-800">Profile picture</span>
              <span className="mt-0.5 block text-[11.5px] text-espresso-400">A photo, or one of the built-in icons</span>
            </span>
            <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-espresso-300" />
          </button>
        }
      />

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
          that doesn't exist costs a line of attention on every visit to advertise itself once.
          Browser "add to home screen" instructions used to sit here too (InstallPrompt) — removed
          along with InstallBanner, see the design-decision note in "PWA & push". */}

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
