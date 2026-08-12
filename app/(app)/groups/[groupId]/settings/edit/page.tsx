import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { EditSettingsForm } from '@/components/groups/SettingsActions';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * The owner's edit view for "how this group plays" — its own route rather than an expansion inside
 * the settings list, so hardware back cancels it and a half-finished draft can't sit hidden behind
 * a collapsed card. A non-owner 404s here rather than 403ing, same as everywhere else.
 */
export default async function EditGroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase.from('groups').select('id, name, owner_id').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  if (group!.owner_id !== user?.id) notFound();

  const { data: settings } = await supabase.from('group_settings').select('*').eq('group_id', groupId).single();
  notFoundIfEmpty(settings);

  return (
    <main className="mx-auto max-w-lg px-5 pb-7 pt-[30px]">
      <EditSettingsForm groupId={groupId} groupName={group!.name} settings={settings as GroupSettings} />
    </main>
  );
}
