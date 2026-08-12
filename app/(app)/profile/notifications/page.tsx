import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { NotificationPreferences, type GroupNotificationPrefs } from '@/components/profile/NotificationPreferences';

/** /profile/notifications — the one place every push preference lives, one tap from the settings
 * block on the profile page. The device-level opt-in is the "All notifications" master at the top
 * of NotificationPreferences rather than a card of its own, because nothing below it matters until
 * this device is actually subscribed. */
export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase
      .from('memberships')
      .select('group_id, notify_group, notify_markets, notify_results, notify_admin, groups(name, avatar_key)')
      .eq('user_id', user.id)
      .in('status', ['active', 'dormant']),
    supabase.from('users').select('notify_nudges, notify_promos').eq('id', user.id).single(),
  ]);

  const groups: GroupNotificationPrefs[] = (memberships ?? []).map((m: any) => ({
    groupId: m.group_id,
    groupName: m.groups?.name ?? '',
    avatarKey: m.groups?.avatar_key ?? null,
    notifyGroup: m.notify_group,
    notifyMarkets: m.notify_markets,
    notifyResults: m.notify_results,
    notifyAdmin: m.notify_admin,
  }));
  groups.sort((a, b) => a.groupName.localeCompare(b.groupName));

  return (
    <main className="mx-auto max-w-lg space-y-3.5 px-5 py-8">
      <PageHeader title="Notifications" backHref="/profile" backLabel="Profile" />

      <NotificationPreferences
        groups={groups}
        notifyNudges={profile?.notify_nudges ?? true}
        notifyPromos={profile?.notify_promos ?? true}
      />
    </main>
  );
}
