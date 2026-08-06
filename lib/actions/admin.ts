'use server';

import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export async function sendAdminBroadcast(
  groupId: string,
  title: string,
  body: string,
  targetUserId: string | null
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  return runRpc<null>(
    await supabase.rpc('send_admin_broadcast', { p_group_id: groupId, p_title: title, p_body: body, p_target_user_id: targetUserId })
  );
}
