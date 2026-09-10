'use server';

import { createClient } from '@/lib/supabase/server';

/** Every share surface, as the `context` key `log_share_click` stores on the lifecycle_events row.
 * `reveal_ticket` / `profile_record` sit behind SHARE_BUTTONS_ENABLED; `called_it_card` and the
 * five `wrapped_*` contexts (one per Wrapped card) sit behind STORY_CARDS_ENABLED (lib/flags.ts).
 * The function itself does not validate against a list, it just truncates to 32 characters, so a
 * new context is a client-side addition only. Keep every value under 32 characters. */
export type ShareClickContext =
  | 'reveal_ticket'
  | 'profile_record'
  | 'called_it_card'
  | 'wrapped_standings'
  | 'wrapped_biggest_win'
  | 'wrapped_worst_call'
  | 'wrapped_rivalry'
  | 'wrapped_closing';

/**
 * Fire-and-forget telemetry for the share buttons. No user-facing error path: a failed click log
 * shouldn't interrupt or even be visible during an actual share.
 */
export async function logShareClick(context: ShareClickContext, groupId?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('log_share_click', { p_context: context, p_group_id: groupId ?? null });
  if (error) {
    console.error('logShareClick failed', error);
  }
}
