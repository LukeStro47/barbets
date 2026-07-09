'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRpc, type ActionResult } from '@/lib/errors';

export async function setNotificationsEnabled(enabled: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('users').update({ notifications_enabled: enabled }).eq('id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/profile');
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
