import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client — bypasses RLS entirely. Server-only (the
 * `server-only` import throws a build error if this is ever pulled into a
 * client bundle). Reserved for the few operations that must run outside a
 * single user's authority: push fan-out and the expire_stale() cron trigger
 * (Phase 6). Never use this for anything a Server Action could do as the
 * calling user instead.
 */
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
