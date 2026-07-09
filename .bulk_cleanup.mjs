import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// 1. Delete all groups owned by bb-* test users (cascades markets/bets/
//    memberships/ledger/notification_events/etc).
let page = 1;
const testUserIds = [];
while (true) {
  const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  testUserIds.push(...data.users.filter((u) => u.email?.startsWith('bb-')).map((u) => u.id));
  if (data.users.length < 200) break;
  page++;
}
console.log('found', testUserIds.length, 'bb- test users');

// delete in batches to avoid overly long IN() clauses
const BATCH = 100;
let groupsDeleted = 0;
for (let i = 0; i < testUserIds.length; i += BATCH) {
  const batch = testUserIds.slice(i, i + BATCH);
  const { data: deleted, error } = await admin.from('groups').delete().in('owner_id', batch).select('id');
  if (error) throw error;
  groupsDeleted += deleted?.length ?? 0;
}
console.log('deleted', groupsDeleted, 'groups owned by test users');

// Also catch any stray "Test Group ..." named groups not owned by a bb- user
// (e.g. owned by a since-orphaned reference), matched by name pattern.
const { data: strayGroups } = await admin.from('groups').select('id, name').ilike('name', 'Test Group %');
if (strayGroups && strayGroups.length > 0) {
  const { error } = await admin.from('groups').delete().in('id', strayGroups.map((g) => g.id));
  if (error) throw error;
  console.log('deleted', strayGroups.length, 'additional stray "Test Group ..." rows');
}

// 2. Now delete the users themselves (should succeed now that they own no groups).
let deletedUsers = 0;
let failedUsers = 0;
for (const id of testUserIds) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    failedUsers++;
    console.error('failed to delete user', id, error.message);
  } else {
    deletedUsers++;
  }
}
console.log('deleted', deletedUsers, 'users,', failedUsers, 'failed');

// 3. Final counts.
const { count: groupCount } = await admin.from('groups').select('id', { count: 'exact', head: true });
const { count: marketCount } = await admin.from('markets').select('id', { count: 'exact', head: true });
const { count: eventCount } = await admin.from('notification_events').select('id', { count: 'exact', head: true });
console.log('remaining -> groups:', groupCount, 'markets:', marketCount, 'notification_events:', eventCount);
