'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * Fire-and-forget telemetry for the two share buttons, both currently gated behind
 * SHARE_BUTTONS_ENABLED (see lib/flags.ts) — this call sits behind the same flag at
 * each call site, so it never actually fires today. No user-facing error path: a
 * failed click log shouldn't interrupt or even be visible during an actual share.
 */
export async function logShareClick(context: 'reveal_ticket' | 'profile_record', groupId?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('log_share_click', { p_context: context, p_group_id: groupId ?? null });
  if (error) {
    console.error('logShareClick failed', error);
  }
}
