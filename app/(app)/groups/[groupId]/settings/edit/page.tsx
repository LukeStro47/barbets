import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { EditSettingsForm } from '@/components/groups/SettingsActions';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * The edit view for "how this group plays" — its own route rather than an expansion inside
 * the settings list, so hardware back cancels it and a half-finished draft can't sit hidden behind
 * a collapsed card. A private group's owner-only gate is unchanged; a public group also lets its
 * moderators in, since update_group_settings() itself now allows them to call it (see
 * "Public groups" in ARCHITECTURE.md). A caller with neither role 404s here rather than 403ing,
 * same as everywhere else.
 */
export default async function EditGroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase.from('groups').select('id, name, owner_id, is_public').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  const isOwner = group!.owner_id === user?.id;
  if (!isOwner) {
    if (!group!.is_public) notFound();
    const { data: membership } = await supabase.from('memberships').select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle();
    if (membership?.role !== 'moderator') notFound();
  }

  const { data: settings } = await supabase.from('group_settings').select('*').eq('group_id', groupId).single();
  notFoundIfEmpty(settings);

  return (
    <main className="mx-auto max-w-lg px-5 pb-7 pt-[30px]">
      <EditSettingsForm groupId={groupId} groupName={group!.name} settings={settings as GroupSettings} isPublic={group!.is_public} />
    </main>
  );
}
