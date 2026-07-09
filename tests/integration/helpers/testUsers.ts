import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('.env.local is missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
}

// Bypasses RLS entirely — used only for test setup/teardown (creating and
// deleting real auth users) and for assertions that need to observe true
// system state (e.g. "did the ledger conserve tokens") independent of any
// single user's RLS-filtered view.
export const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_PASSWORD = 'barbets-integration-test-pw-1!';

export interface TestUser {
  tag: string;
  id: string;
  client: SupabaseClient;
}

/**
 * Creates real auth users (via the admin API) and real per-user sessions,
 * so every assertion in a test runs through actual RLS/PostgREST, not a
 * service-role bypass. testTag should be short (<=4 chars) — usernames
 * must stay within the 20-char format constraint.
 */
export async function createTestUsers(testTag: string, tags: string[]): Promise<Record<string, TestUser>> {
  const suffix = `${testTag}${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const result: Record<string, TestUser> = {};

  for (const tag of tags) {
    const email = `bb-${suffix}-${tag}@example.com`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createTestUsers(${tag}): ${error?.message}`);

    // Mirrors the app's own auto-created profile row (no more global
    // username to claim) — nicknames are per-group now, set on join/create.
    const { error: profileErr } = await adminClient.from('users').insert({ id: data.user.id });
    if (profileErr) throw new Error(`createTestUsers profile (${tag}): ${profileErr.message}`);

    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (signInErr) throw new Error(`createTestUsers sign-in (${tag}): ${signInErr.message}`);

    result[tag] = { tag, id: data.user.id, client };
  }

  return result;
}

/**
 * Deletes every test user, and — critically — any group they own first.
 * groups.owner_id has no ON DELETE CASCADE (by design, so a real user
 * deleting their account can't silently vaporize a whole friend group's
 * history), which means deleteUser() fails outright for anyone who created
 * a group in the test. The original version of this helper swallowed that
 * failure with `.catch(() => {})`, so every single test run leaked its
 * owner user and their entire group (and everything cascaded under it —
 * markets, bets, notification_events, ...) into the shared hosted project
 * forever. Confirmed 365 leaked users / 109 groups accumulated this way
 * before this was caught. Deleting owned groups first (which cascades
 * properly) makes deleteUser() actually succeed.
 */
export async function cleanupTestUsers(users: Record<string, TestUser>): Promise<void> {
  const userIds = Object.values(users).map((u) => u.id);
  if (userIds.length > 0) {
    await adminClient.from('groups').delete().in('owner_id', userIds);
  }
  for (const u of Object.values(users)) {
    const { error } = await adminClient.auth.admin.deleteUser(u.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`cleanupTestUsers: failed to delete ${u.tag} (${u.id}): ${error.message}`);
    }
  }
}

/** Backdates a row's timestamp column via the service-role client, so tests don't have to sleep through real 24h/48h windows. */
export async function backdate(table: string, matchColumn: string, matchValue: string, column: string, hoursAgo: number) {
  const { error } = await adminClient
    .from(table)
    .update({ [column]: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString() })
    .eq(matchColumn, matchValue);
  if (error) throw new Error(`backdate ${table}.${column}: ${error.message}`);
}
