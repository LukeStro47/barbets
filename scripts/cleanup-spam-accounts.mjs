import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

// Finds auth users with zero memberships (never joined or created a group,
// so nothing of theirs is visible anywhere in the app) and, optionally,
// deletes them. Dry run by default - prints a report and does nothing else.
// Pass --delete to actually remove the accounts it lists.
//
// Unlike .bulk_cleanup.mjs, this deliberately does NOT fall back through
// .env.test.local - this script's whole purpose is finding spam in
// production, so it always reads .env.local (production) unless real env
// vars are set (e.g. to point it at staging on purpose).
const readEnvFile = (name) => (fs.existsSync(name)
  ? Object.fromEntries(
      fs.readFileSync(name, 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    )
  : {});
const env = { ...readEnvFile('.env.local'), ...process.env };

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set them in .env.local or the environment)');
}

const args = process.argv.slice(2);
const shouldDelete = args.includes('--delete');
const minAgeDaysArg = args.find((a) => a.startsWith('--min-age-days='));
const minAgeDays = minAgeDaysArg ? Number(minAgeDaysArg.split('=')[1]) : 3;

console.log('target:', env.NEXT_PUBLIC_SUPABASE_URL);
console.log('mode:', shouldDelete ? 'DELETE' : 'dry run (pass --delete to actually remove accounts)');
console.log('skipping accounts younger than', minAgeDays, 'day(s) (--min-age-days=N to change)');
console.log('');

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// 1. Every user who belongs to at least one group - never a deletion candidate.
const memberUserIds = new Set();
{
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await admin.from('memberships').select('user_id').range(from, from + PAGE - 1);
    if (error) throw error;
    data.forEach((row) => memberUserIds.add(row.user_id));
    if (data.length < PAGE) break;
    from += PAGE;
  }
}

// 2. Platform admins - never a deletion candidate, regardless of memberships.
const adminUserIds = new Set();
{
  const { data, error } = await admin.from('app_admins').select('user_id');
  if (error) throw error;
  data.forEach((row) => adminUserIds.add(row.user_id));
}

// 3. Every auth user, paginated.
const allUsers = [];
{
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    allUsers.push(...data.users);
    if (data.users.length < 200) break;
    page++;
  }
}

const cutoff = Date.now() - minAgeDays * 24 * 60 * 60 * 1000;
const candidates = allUsers.filter((u) =>
  !memberUserIds.has(u.id) &&
  !adminUserIds.has(u.id) &&
  new Date(u.created_at).getTime() < cutoff
);

console.log('total auth users:', allUsers.length);
console.log('users with a membership:', memberUserIds.size);
console.log('platform admins:', adminUserIds.size);
console.log('candidates (no membership, not admin, older than', minAgeDays, 'day(s)):', candidates.length);
console.log('');

for (const u of candidates.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
  console.log(
    u.created_at.slice(0, 10),
    '|', (u.email_confirmed_at ? 'confirmed' : 'unconfirmed').padEnd(11),
    '|', 'last sign-in:', (u.last_sign_in_at ?? 'never').slice(0, 10),
    '|', u.email
  );
}

if (!shouldDelete) {
  console.log('');
  console.log('dry run only, nothing deleted. re-run with --delete to remove the accounts listed above.');
  process.exit(0);
}

console.log('');
let deleted = 0;
let failed = 0;
for (const u of candidates) {
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) {
    failed++;
    console.error('failed to delete', u.email, error.message);
  } else {
    deleted++;
  }
}
console.log('deleted', deleted, 'accounts,', failed, 'failed');
