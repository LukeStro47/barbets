// Populates the STAGING Supabase project with a handful of groups in different states, so the
// app can be previewed against realistic data (`npx next dev` already points at staging via
// .env.development.local). Run: `node scripts/seed-staging.mjs [userId]`.
//
// Everything is built through the real SECURITY DEFINER functions, signed in as real users, so
// the resulting rows are exactly what the app itself would have produced. The only service-role
// writes are timestamp backdates (to skip real challenge windows and make the feed look lived
// in) and forcing one market into `closed`, the same tricks the integration suite uses.
//
// Re-runnable: each run deletes the groups it created last time (matched by name, owned by a
// seed user or the target user) and builds them fresh. Re-run it whenever the time-sensitive
// states have decayed: a `proposed`/`disputed` market finalizes once its window passes and
// something calls expire_stale() (CI does), and a `pending_sponsor` market voids after 24h.
//
// The cast are `seed-*@barbets-staging.invalid` users, deliberately not `bb-*`, so CI's
// .bulk_cleanup.mjs sweep leaves them alone. The target user is signed in through an admin
// magic-link token, which issues a session without sending any email.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const readEnvFile = (name) => (fs.existsSync(name)
  ? Object.fromEntries(
      fs.readFileSync(name, 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    )
  : {});

const staging = readEnvFile('.env.development.local');
const prod = readEnvFile('.env.local');
const URL = staging.NEXT_PUBLIC_SUPABASE_URL;
const ANON = staging.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = staging.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) throw new Error('.env.development.local must hold the staging Supabase keys');
// Fail closed: compare project refs (not raw strings, so quotes or a trailing slash can't slip
// past), and refuse outright when there's no .env.local to tell production apart from.
const projectRef = (u) => (u ?? '').replace(/^["']|["']$/g, '').match(/^https?:\/\/([a-z0-9]+)\./i)?.[1]?.toLowerCase() ?? null;
const stagingRef = projectRef(URL);
const prodRef = projectRef(prod.NEXT_PUBLIC_SUPABASE_URL);
if (!stagingRef) throw new Error(`Refusing to seed: can't read a project ref from ${URL}`);
if (!prodRef) throw new Error('Refusing to seed: no .env.local production URL to check against');
if (stagingRef === prodRef) throw new Error('Refusing to seed: .env.development.local points at production');
console.log('seeding', URL);

const TARGET_USER_ID = process.argv[2] ?? 'ca7af56e-b8a0-4dde-be45-975bbf53dcbd';
const POLICY_VERSION = fs.readFileSync('lib/legal.ts', 'utf8').match(/CURRENT_POLICY_VERSION\s*=\s*'([^']+)'/)[1];
const SEED_PASSWORD = 'barbets-staging-seed-pw-1!';
const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

const GROUP_NAMES = {
  pub: 'The Crown & Anchor',
  trip: 'Lisbon Lads 2026',
  office: 'Office Fantasy League',
  flat: 'Flat 4B',
  wedding: "Ellie & Dev's Wedding",
};

// ---------------------------------------------------------------------------------------------
// People

const CAST = ['maya', 'jake', 'priya', 'tom', 'sam', 'ellie', 'dev', 'chloe'];
const AVATARS = ['ace', 'beer', 'dice', 'eight-ball', 'football', 'horseshoe', 'roulette', 'ticket'];

async function seedUser(name, i) {
  const email = `seed-${name}@barbets-staging.invalid`;
  let { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error) throw new Error(`createUser ${name}: ${error.message}`);
    user = data.user;
  }
  await admin.from('users').upsert({ id: user.id, accepted_policy_version: POLICY_VERSION });
  await admin.from('users').update({ avatar_preset_key: AVATARS[i % AVATARS.length] }).eq('id', user.id);
  const client = createClient(URL, ANON, noSession);
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`signIn ${name}: ${error.message}`);
  return wrap(name, user.id, client);
}

async function targetUser() {
  const { data: u, error } = await admin.auth.admin.getUserById(TARGET_USER_ID);
  if (error || !u?.user) throw new Error(`target user ${TARGET_USER_ID} not found on staging`);
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  if (linkErr) throw new Error(`generateLink: ${linkErr.message}`);
  const client = createClient(URL, ANON, noSession);
  const { error: otpErr } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp: ${otpErr.message}`);
  return wrap('luke', TARGET_USER_ID, client);
}

function wrap(name, id, client) {
  return {
    name,
    id,
    client,
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new Error(`${name} ${fn}: ${error.message}`);
      return Array.isArray(data) ? data[0] : data;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Building blocks

async function makeGroup(owner, members, name, settings) {
  const s = {
    seed: 1000, seasonsEnabled: false, seasonLength: null, requireEndorsement: false,
    prize: null, punishment: null, windowHours: 10, openBetting: true, ...settings,
  };
  const g = await owner.rpc('create_group', {
    p_name: name, p_seed_amount: s.seed, p_seasons_enabled: s.seasonsEnabled,
    p_season_length: s.seasonLength, p_nickname: owner.name, p_season_custom_ends_at: null,
    p_timezone: 'Europe/London',
  });
  await owner.rpc('update_group_settings', {
    p_group_id: g.id, p_seed_amount: s.seed, p_seasons_enabled: s.seasonsEnabled,
    p_season_length: s.seasonLength, p_timezone: 'Europe/London', p_betting_enabled: true,
    p_accepting_members: true, p_season_custom_ends_at: null,
    p_require_endorsement: s.requireEndorsement, p_allow_hedged_bets: true,
    p_resolution_window_hours: s.windowHours, p_prize_text: s.prize, p_punishment_text: s.punishment,
  });
  if (s.avatar) await owner.rpc('set_group_avatar', { p_group_id: g.id, p_avatar_key: s.avatar });
  for (const m of members) await m.rpc('join_group', { p_invite_code: g.invite_code, p_nickname: m.name, p_join_source: 'code' });
  if (s.seasonsEnabled && s.openBetting) await openCurrentSeason(owner, g.id);
  console.log(`  group "${name}" (${g.invite_code})`);
  return g;
}

async function openCurrentSeason(owner, groupId) {
  const { data: season } = await admin.from('seasons').select('id').eq('group_id', groupId).eq('status', 'active').single();
  await owner.rpc('open_season_betting', { p_season_id: season.id });
}

/** opts: { type, line, unit, options, about: [users], closesIn, desc, sponsor } */
async function market(creator, groupId, title, opts = {}) {
  const m = await creator.rpc('create_market', {
    p_group_id: groupId,
    p_title: title,
    p_description: opts.desc ?? 'Settled by whoever was there. Photo proof if it is contested.',
    p_market_type: opts.type ?? 'yes_no',
    p_closes_at: iso(opts.closesIn ?? 5 * DAY),
    p_line: opts.line ?? null,
    p_unit: opts.unit ?? null,
    p_options: opts.options ?? null,
    p_subject_user_ids: (opts.about ?? []).map((u) => u.id),
  });
  if (opts.sponsor) await opts.sponsor.rpc('sponsor_market', { p_market_id: m.id });
  if (opts.type === 'multiple_choice') {
    const { data } = await admin.from('market_options').select('id, label').eq('market_id', m.id).order('sort_order');
    m.options = Object.fromEntries(data.map((o) => [o.label, o.id]));
  }
  return m;
}

/** pick is a side ('yes'/'no'/'over'/'under') or a multiple-choice option label. */
async function bet(user, m, pick, amount) {
  const isOption = m.options && pick in m.options;
  await user.rpc('place_bet', {
    p_market_id: m.id, p_amount: amount,
    p_side: isOption ? null : pick, p_option_id: isOption ? m.options[pick] : null,
  });
}

async function propose(user, m, pick, justification, actualValue = null) {
  const isOption = m.options && pick in m.options;
  await user.rpc('propose_resolution', {
    p_market_id: m.id, p_outcome: isOption ? null : pick, p_option_id: isOption ? m.options[pick] : null,
    p_justification: justification, p_actual_value: actualValue,
  });
}

async function vote(user, m, pick) {
  const isOption = m.options && pick in m.options;
  await user.rpc('cast_vote', { p_market_id: m.id, p_outcome: isOption ? null : pick, p_option_id: isOption ? m.options[pick] : null });
}

/** Propose, let the challenge window lapse (backdated), finalize, then age the market. */
async function settle(m, proposer, pick, daysAgo, justification = 'Saw it with my own eyes.', actualValue = null) {
  await propose(proposer, m, pick, justification, actualValue);
  await admin.from('resolution_proposals').update({ proposed_at: iso(-11 * HOUR) }).eq('market_id', m.id);
  await proposer.rpc('finalize_market', { p_market_id: m.id });
  await age(m, daysAgo);
}

/** Back-date a settled market so the feed and ledger spread over real-looking days. */
async function age(m, daysAgo) {
  const resolved = iso(-daysAgo * DAY);
  await admin.from('markets').update({
    created_at: iso(-(daysAgo + 3) * DAY), closed_at: iso(-(daysAgo + 0.5) * DAY), resolved_at: resolved,
  }).eq('id', m.id);
  await admin.from('resolution_proposals').update({ proposed_at: iso(-(daysAgo + 0.5) * DAY) }).eq('market_id', m.id);
}

async function comment(user, m, body) {
  await user.rpc('post_market_comment', { p_market_id: m.id, p_body: body });
}

// ---------------------------------------------------------------------------------------------
// Reset

async function wipePrevious(ownerIds) {
  const { data } = await admin.from('groups').select('id, name').in('name', Object.values(GROUP_NAMES)).in('owner_id', ownerIds);
  if (data?.length) {
    // Owner-initiated delete would refund first, but a plain delete cascades everything the
    // same way .bulk_cleanup.mjs does, and nothing here is real money.
    const { error } = await admin.from('groups').delete().in('id', data.map((g) => g.id));
    if (error) throw new Error(`wipe: ${error.message}`);
    console.log(`removed ${data.length} previously seeded group(s)`);
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios

/** Luke owns it. Continuous play, endorsement on: one market in every status there is. */
async function pubGroup(p) {
  const { luke, maya, jake, priya, tom, sam } = p;
  const g = await makeGroup(luke, [maya, jake, priya, tom, sam], GROUP_NAMES.pub, {
    requireEndorsement: true, avatar: 'beer',
    prize: 'Loser buys the first round for a month',
    punishment: 'Wears the quiz hat all night',
  });

  // Settled history first, so balances have moved by the time the live markets take bets.
  const won = await market(maya, g.id, 'Will Jake finish the Brighton half under 2 hours?', { about: [jake], sponsor: luke });
  await bet(luke, won, 'yes', 200); await bet(maya, won, 'no', 150); await bet(priya, won, 'no', 120); await bet(tom, won, 'yes', 50);
  await settle(won, maya, 'yes', 9, '1:54:12 on the official results page.');

  const lost = await market(sam, g.id, 'Will the quiz master use the same music round again?', { sponsor: priya });
  await bet(luke, lost, 'no', 150); await bet(sam, lost, 'yes', 100); await bet(jake, lost, 'yes', 80);
  await settle(lost, sam, 'yes', 7, 'Abba. Again.');

  const mcDone = await market(tom, g.id, 'Who gets the most answers wrong this week?', {
    type: 'multiple_choice', options: ['@jake', '@sam', 'Tom', 'Nobody, it is a tie'], sponsor: maya,
  });
  await bet(luke, mcDone, '@sam', 80); await bet(maya, mcDone, '@sam', 60); await bet(priya, mcDone, 'Tom', 40);
  await settle(mcDone, maya, '@sam', 5, 'Sam thought Canberra was in New Zealand.');

  const ouDone = await market(priya, g.id, 'How many rounds does Tom buy on his birthday?', {
    type: 'over_under', line: 3.5, unit: 'rounds', about: [tom], sponsor: luke,
  });
  await bet(luke, ouDone, 'under', 100); await bet(jake, ouDone, 'over', 120); await bet(sam, ouDone, 'under', 60);
  await settle(ouDone, priya, 'over', 4, 'Five rounds, and one of them was shots.', 5);

  const aboutLukeDone = await market(jake, g.id, 'Will Luke get the karaoke mic before 10pm?', { about: [luke], sponsor: maya });
  await bet(jake, aboutLukeDone, 'yes', 90); await bet(priya, aboutLukeDone, 'no', 70); await bet(sam, aboutLukeDone, 'yes', 40);
  await settle(aboutLukeDone, jake, 'yes', 3, 'Mr Brightside at 9:41pm. There is video.');

  const voided = await market(tom, g.id, 'Will the pub reopen the beer garden this month?', { sponsor: sam });
  await bet(luke, voided, 'yes', 30); await bet(tom, voided, 'no', 30);
  await luke.rpc('void_market_by_owner', { p_market_id: voided.id });
  await age(voided, 6);

  // A disputed market settled by a full vote.
  const voteDone = await market(priya, g.id, 'Did Maya actually hit a bullseye in darts?', { about: [maya], sponsor: tom });
  await bet(luke, voteDone, 'no', 60); await bet(priya, voteDone, 'yes', 60); await bet(jake, voteDone, 'no', 40);
  await propose(priya, voteDone, 'yes', 'It was on the line, line counts.');
  await jake.rpc('challenge_resolution', { p_market_id: voteDone.id, p_reason: 'Line does not count in this pub.' });
  for (const u of [luke, jake, priya, tom, sam]) await vote(u, voteDone, u === priya ? 'yes' : 'no');
  await age(voteDone, 2);

  // Live markets.
  const open1 = await market(jake, g.id, 'Will Priya beat her 5k PB at parkrun on Saturday?', { about: [priya], sponsor: maya, closesIn: 6 * DAY });
  await bet(luke, open1, 'yes', 75); await bet(jake, open1, 'no', 50); await bet(maya, open1, 'yes', 40); await bet(tom, open1, 'no', 90);
  await comment(jake, open1, 'She has been training in the rain all week, I am nervous.');
  await comment(luke, open1, '@jake nervous because you bet against her?');

  const open2 = await market(luke, g.id, 'How many pints does Sam get through on Friday?', {
    type: 'over_under', line: 6.5, unit: 'pints', about: [sam], sponsor: priya, closesIn: 3 * DAY,
  });
  await bet(maya, open2, 'over', 100); await bet(jake, open2, 'under', 60); await bet(tom, open2, 'over', 30);
  await maya.rpc('request_clarification', { p_market_id: open2.id, p_question: 'Do halves count as half a pint or a whole one?' });

  const open3 = await market(maya, g.id, 'Which team wins quiz night this Thursday?', {
    type: 'multiple_choice', options: ['Quizteama Aguilera', 'Les Quizerables', 'Universally Challenged', 'Us, finally'],
    sponsor: sam, closesIn: 4 * DAY,
  });
  await bet(luke, open3, 'Us, finally', 50); await bet(luke, open3, 'Us, finally', 25);
  await bet(maya, open3, 'Les Quizerables', 120); await bet(priya, open3, 'Quizteama Aguilera', 80);
  await bet(tom, open3, 'Universally Challenged', 40); await bet(sam, open3, 'Us, finally', 30);
  await luke.rpc('reveal_bet_in_comment', { p_market_id: open3.id, p_body: 'Backing us. Somebody has to.' });
  await comment(maya, open3, 'Bless.');

  const closingSoon = await market(tom, g.id, 'Will the 23:10 bus actually turn up tonight?', { sponsor: jake, closesIn: 7 * HOUR });
  await bet(luke, closingSoon, 'no', 40); await bet(tom, closingSoon, 'yes', 25);
  await admin.from('markets').update({ closes_at: iso(90 * 60_000) }).eq('id', closingSoon.id);

  const aboutLukeOpen = await market(priya, g.id, 'Will Luke shave off the moustache before Christmas?', { about: [luke], sponsor: tom, closesIn: 12 * DAY });
  await bet(priya, aboutLukeOpen, 'yes', 110); await bet(jake, aboutLukeOpen, 'no', 70); await bet(maya, aboutLukeOpen, 'yes', 55);

  // Waiting on Luke to endorse it, and Luke's own waiting on someone else.
  await market(jake, g.id, 'Will the fruit machine pay out before last orders?', { closesIn: 2 * DAY });
  await market(luke, g.id, 'Will Tom remember his own quiz team name?', { closesIn: 2 * DAY });

  // Closed, nobody has proposed yet.
  const closed = await market(sam, g.id, 'Will anyone finish the 2kg mixed grill?', { sponsor: maya, closesIn: DAY });
  await bet(luke, closed, 'no', 60); await bet(sam, closed, 'yes', 45); await bet(priya, closed, 'no', 30);
  await admin.from('markets').update({ status: 'closed', closes_at: iso(-2 * HOUR), closed_at: iso(-2 * HOUR) }).eq('id', closed.id);

  // Proposed, inside its challenge window (Luke can challenge).
  const proposed = await market(maya, g.id, 'Will Jake order the vegan option and pretend he likes it?', { about: [jake], sponsor: priya });
  await bet(luke, proposed, 'no', 80); await bet(maya, proposed, 'yes', 70); await bet(sam, proposed, 'yes', 20);
  await propose(maya, proposed, 'yes', 'Ordered the jackfruit burger, said "honestly lovely".');

  // Disputed, mid-vote, Luke has not voted yet.
  const disputed = await market(tom, g.id, 'Did Sam really get a hole in one at crazy golf?', { about: [sam], sponsor: luke });
  await bet(luke, disputed, 'yes', 50); await bet(tom, disputed, 'no', 50); await bet(maya, disputed, 'no', 35);
  await propose(tom, disputed, 'no', 'It bounced off the windmill and the staff moved it.');
  await priya.rpc('challenge_resolution', { p_market_id: disputed.id, p_reason: 'A bounce still counts.' });
  await vote(maya, disputed, 'no'); await vote(priya, disputed, 'yes');

  return g;
}

/** Maya owns it. Seasons on: season 1 is over and archived, season 2 is live with a countdown. */
async function tripGroup(p) {
  const { luke, maya, jake, tom, dev, chloe } = p;
  const g = await makeGroup(maya, [luke, jake, tom, dev, chloe], GROUP_NAMES.trip, {
    seasonsEnabled: true, seasonLength: '1m', avatar: 'roulette',
    prize: 'Picks the restaurant on the last night', punishment: 'Carries everyone\'s bags to the airport',
  });

  const s1a = await market(maya, g.id, 'Will Tom miss the flight to Lisbon?', { about: [tom], closesIn: 6 * DAY });
  await bet(luke, s1a, 'yes', 150); await bet(maya, s1a, 'yes', 200); await bet(jake, s1a, 'no', 100); await bet(chloe, s1a, 'no', 80);
  await settle(s1a, jake, 'no', 20, 'Made it with four minutes to spare.');
  const s1b = await market(dev, g.id, 'How many pastéis de nata does Chloe eat in one day?', {
    type: 'over_under', line: 4.5, unit: 'pastries', about: [chloe], closesIn: 6 * DAY,
  });
  await bet(maya, s1b, 'over', 120); await bet(luke, s1b, 'under', 90); await bet(dev, s1b, 'over', 60);
  await settle(s1b, dev, 'over', 18, 'Seven. She called it research.', 7);

  await maya.rpc('end_season', { p_group_id: g.id });
  await admin.from('seasons').update({ started_at: iso(-35 * DAY), ended_at: iso(-14 * DAY) }).eq('group_id', g.id).eq('number', 1);
  await maya.rpc('start_season', { p_group_id: g.id });
  await openCurrentSeason(maya, g.id);

  const s2a = await market(jake, g.id, 'Will we actually make it to the Belém tower before it shuts?', { closesIn: 9 * DAY });
  await bet(luke, s2a, 'no', 70); await bet(jake, s2a, 'yes', 90); await bet(dev, s2a, 'no', 40);
  await comment(dev, s2a, 'Not with Tom in charge of the tram map.');
  const s2b = await market(chloe, g.id, 'Who falls asleep first on the night out?', {
    type: 'multiple_choice', options: ['@tom', '@dev', '@jake', 'Luke'], closesIn: 8 * DAY,
  });
  await bet(luke, s2b, '@tom', 60); await bet(maya, s2b, '@dev', 75); await bet(chloe, s2b, '@tom', 50);
  const s2c = await market(luke, g.id, 'Will Maya haggle a discount at the flea market?', { about: [maya], closesIn: 5 * DAY });
  await bet(jake, s2c, 'yes', 45); await bet(tom, s2c, 'no', 30);
  const s2d = await market(tom, g.id, 'Will it rain on the beach day?', { closesIn: 7 * DAY });
  await bet(luke, s2d, 'no', 100); await bet(tom, s2d, 'yes', 60); await bet(maya, s2d, 'yes', 40);
  await settle(s2d, maya, 'no', 1, 'Thirty degrees and not a cloud.');
  return g;
}

/** Luke owns it, so the owner's side of intermission (starting season 2) is reachable. Season 1 just ended with Luke as champion. */
async function officeGroup(p) {
  const { luke, tom, priya, sam, ellie, chloe } = p;
  const g = await makeGroup(luke, [tom, priya, sam, ellie, chloe], GROUP_NAMES.office, {
    seasonsEnabled: true, seasonLength: '3m', avatar: 'football',
    prize: 'Gets the good desk by the window', punishment: 'Does the coffee run for a week',
  });
  const a = await market(tom, g.id, 'Will Priya\'s team finish top of the league?', { about: [priya], closesIn: 6 * DAY });
  await bet(luke, a, 'yes', 300); await bet(tom, a, 'no', 200); await bet(sam, a, 'no', 150);
  await settle(a, tom, 'yes', 12, 'Final table attached.');
  const b = await market(ellie, g.id, 'Will Sam bench his captain again?', { about: [sam], closesIn: 6 * DAY });
  await bet(luke, b, 'yes', 250); await bet(ellie, b, 'no', 100); await bet(chloe, b, 'no', 120);
  await settle(b, ellie, 'yes', 9, 'Benched Haaland. Twice.');
  const c = await market(chloe, g.id, 'Who gets the wooden spoon?', {
    type: 'multiple_choice', options: ['@sam', '@ellie', '@priya', 'Tom'], closesIn: 6 * DAY,
  });
  await bet(luke, c, '@sam', 100); await bet(chloe, c, '@ellie', 90); await bet(tom, c, '@sam', 60);
  await settle(c, chloe, '@sam', 4, 'Bottom by 40 points.');
  const d = await market(sam, g.id, 'Will Tom stop picking players from his own team?', { about: [tom], closesIn: 6 * DAY });
  await bet(luke, d, 'yes', 80); await bet(sam, d, 'no', 80); await bet(priya, d, 'no', 60);
  await settle(d, sam, 'no', 2, 'Three Spurs players, every single week.');

  await luke.rpc('end_season', { p_group_id: g.id });
  await admin.from('seasons').update({ started_at: iso(-90 * DAY), ended_at: iso(-1 * DAY) }).eq('group_id', g.id).eq('number', 1);
  return g;
}

/** Luke owns it. Brand new: seasons on, but betting for season 1 has not been opened yet. */
async function flatGroup(p) {
  const { luke, chloe, dev } = p;
  return makeGroup(luke, [chloe, dev], GROUP_NAMES.flat, { seasonsEnabled: true, seasonLength: 'manual', openBetting: false, avatar: 'dice' });
}

/** Ellie owns it. The season was ended while two results were still in flight: winding down. */
async function weddingGroup(p) {
  const { luke, ellie, dev, maya, priya, jake } = p;
  const g = await makeGroup(ellie, [dev, luke, maya, priya, jake], GROUP_NAMES.wedding, {
    seasonsEnabled: true, seasonLength: 'manual', avatar: 'horseshoe', prize: 'First dance request', punishment: 'Does the conga solo',
  });
  const a = await market(maya, g.id, 'Will the best man\'s speech go over 10 minutes?', { closesIn: 3 * DAY });
  await bet(luke, a, 'yes', 120); await bet(maya, a, 'yes', 80); await bet(jake, a, 'no', 100);
  await settle(a, maya, 'yes', 1, '14 minutes, three of them about a stag do in Prague.');
  const b = await market(priya, g.id, 'Will Dev cry during the vows?', { about: [dev], closesIn: 3 * DAY });
  await bet(luke, b, 'yes', 90); await bet(priya, b, 'yes', 60); await bet(jake, b, 'no', 70);
  await propose(priya, b, 'yes', 'Visible tears at "in sickness and in health".');
  const c = await market(jake, g.id, 'How many people end up in the fountain?', { type: 'over_under', line: 2.5, unit: 'people', closesIn: 3 * DAY });
  await bet(luke, c, 'over', 70); await bet(jake, c, 'under', 70); await bet(maya, c, 'over', 30);
  await propose(jake, c, 'under', 'Just the two, and one was pushed.', 2);
  await luke.rpc('challenge_resolution', { p_market_id: c.id, p_reason: 'The ring bearer counts.' });
  await ellie.rpc('end_season', { p_group_id: g.id });
  return g;
}

// ---------------------------------------------------------------------------------------------

const luke = await targetUser();
const cast = Object.fromEntries(await Promise.all(CAST.map(async (n, i) => [n, await seedUser(n, i)])));
const people = { luke, ...cast };
await wipePrevious([luke.id, ...Object.values(cast).map((u) => u.id)]);

for (const [label, fn] of [['pub', pubGroup], ['trip', tripGroup], ['office', officeGroup], ['flat', flatGroup], ['wedding', weddingGroup]]) {
  console.log(`building ${label}...`);
  await fn(people);
}

const { data: summary } = await admin.from('memberships').select('nickname, balance, groups(name)').eq('user_id', luke.id);
console.log('\nLuke now sees:');
for (const m of summary) console.log(`  ${m.groups.name.padEnd(26)} as @${m.nickname}, balance ${m.balance}`);
const { data: seasons } = await admin.from('seasons').select('number, status, groups!inner(name)').in('groups.name', Object.values(GROUP_NAMES));
for (const s of seasons) console.log(`  season ${s.number} of ${s.groups.name}: ${s.status}`);
