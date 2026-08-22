'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRpc, type ActionResult } from '@/lib/errors';

/** The master switch: off means no push of any kind, whatever the per-category or per-group
 * preferences say. Goes through an RPC, not a direct `update users` — that table has select and
 * insert policies but deliberately no update policy, so the plain write this used to do matched
 * zero rows and reported success. */
export async function setNotificationsEnabled(enabled: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<unknown>(await supabase.rpc('set_notifications_enabled', { p_enabled: enabled }));
  if (result.error) return { error: result.error };
  revalidatePath('/profile');
  revalidatePath('/profile/notifications');
  return { data: null };
}

/** The two app-wide categories: nudges (we prod you when nothing's happening) and promos. The
 * general per-group ones live on the membership instead, see updateGroupNotificationPrefs. */
export async function updateNotificationCategories(input: {
  notifyNudges: boolean;
  notifyPromos: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<unknown>(
    await supabase.rpc('update_notification_categories', {
      p_notify_nudges: input.notifyNudges,
      p_notify_promos: input.notifyPromos,
    })
  );
  if (result.error) return { error: result.error };
  revalidatePath('/profile/notifications');
  return { data: null };
}

export async function updateGroupNotificationPrefs(
  groupId: string,
  input: { notifyGroup: boolean; notifyMarkets: boolean; notifyResults: boolean; notifyAdmin: boolean }
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<unknown>(
    await supabase.rpc('update_group_notification_prefs', {
      p_group_id: groupId,
      p_notify_group: input.notifyGroup,
      p_notify_markets: input.notifyMarkets,
      p_notify_results: input.notifyResults,
      p_notify_admin: input.notifyAdmin,
    })
  );
  if (result.error) return { error: result.error };
  revalidatePath('/profile/notifications');
  return { data: null };
}

const AVATAR_BUCKET = 'avatars';

/** FormData, not a bare File — the reliable Server Action pattern for file payloads (see
 * proposeResolution in lib/actions/resolution.ts). The client has already run the file through
 * compressAvatarImage(), so this just uploads it to a fixed, deterministic path and flips the
 * caller's own avatar_updated_at. Upsert means a re-upload overwrites the same object rather than
 * accumulating orphans, and avatar_updated_at is what busts the cache on the rendered URL. */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const file = formData.get('avatar');
  if (!(file instanceof File)) return { error: 'No photo received.' };

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(AVATAR_BUCKET)
    .upload(`${user.id}.jpg`, file, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) return { error: 'Could not upload the photo. Try again.' };

  const result = await runRpc<null>(await supabase.rpc('set_avatar_uploaded', { p_uploaded: true }));
  if (result.error) return result;
  revalidatePath('/profile');
  revalidatePath('/profile/account');
  return { data: null };
}

/** Clears avatar_updated_at rather than deleting the underlying Storage object — a re-upload
 * overwrites the same fixed path anyway, and userAvatarSrc() already renders nothing once the
 * timestamp is null, same "return null rather than a broken image" convention groupAvatarSrc()
 * uses for a retired group logo key. */
export async function removeAvatar(): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('set_avatar_uploaded', { p_uploaded: false }));
  if (result.error) return result;
  revalidatePath('/profile');
  revalidatePath('/profile/account');
  return { data: null };
}

/**
 * Two-part deletion: delete_account() (run as the user, via their own
 * client) handles every public-schema consequence — refunding open bets,
 * voiding markets they're a subject of, marking memberships removed,
 * rotating invite codes — exactly like remove_member() does to someone
 * else, just self-initiated. It deliberately refuses if the caller still
 * owns a group (transferring or deleting that is a separate, conscious
 * choice). Only once that succeeds does this reach for the admin client to
 * delete the actual auth.users row — an operation no ordinary user's
 * session can perform, and the only reason this action needs the
 * service-role client at all.
 */
export async function deleteAccount(): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const cleanup = await runRpc<null>(await supabase.rpc('delete_account'));
  if (cleanup.error) return cleanup;

  const admin = createAdminClient();
  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) return { error: 'Your groups were cleaned up, but the account itself failed to delete. Try again or contact support.' };

  await supabase.auth.signOut();
  redirect('/');
}
