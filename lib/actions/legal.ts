'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import { CURRENT_POLICY_VERSION } from '@/lib/legal';

/** Called from PolicyReapprovalGate's "I agree" button. Always stamps the app's own
 * CURRENT_POLICY_VERSION rather than trusting a client-supplied version string, so an out-of-date
 * client can't accept-and-dismiss against a version that's no longer current. */
export async function acceptCurrentPolicy(): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<unknown>(await supabase.rpc('accept_current_policy', { p_version: CURRENT_POLICY_VERSION }));
  if (result.error) return { error: result.error };
  revalidatePath('/', 'layout');
  return { data: null };
}
