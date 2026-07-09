# Barbets — how it all works

Barbets is a multi-tenant, play-money prediction market platform for private friend groups. Each group runs its own sealed token economy — no real money ever changes hands. Members create markets ("Will Jake finish the marathon?"), bet tokens on the outcome, and settle up via a parimutuel payout once the group resolves what actually happened. The standout feature is that a market can be *about* someone (`@mentioned` as a "subject"), and that person cannot see the market exists — not in their feed, not in counts, not in notifications — until it resolves.

Live at **https://mybarbets.com**. Installable as a PWA (Android + iOS) with real web push notifications.

## Tech stack

- **Next.js 16** (App Router, React 19, TypeScript) — server components for reads, Server Actions for all mutations
- **Supabase** — Postgres, Auth, Row Level Security, Edge Functions (Deno), pg_cron + pg_net for scheduled jobs
- **Tailwind CSS v4** — CSS-based `@theme`, no `tailwind.config.ts`
- **Vercel** — hosting, deploys via `vercel --prod`
- **Vitest** — integration tests that hit the real hosted Supabase project as real logged-in users (no mocks)

## Project structure

```
app/
  (auth)/login                        — sign in/up (no separate profile-claim step)
  (app)/groups, groups/[groupId]/...  — group hub, feed, leaderboard, hall-of-fame,
                                         settings, intermission, markets/new,
                                         markets/[marketId], markets/[marketId]/reveal
  (app)/profile, (app)/inbox          — account settings, "waiting on you" feed
  how-it-works, join/[code]           — public explainer, invite-link preview
lib/
  actions/*.ts        — Server Actions, one file per domain (markets, bets, resolution,
                         groups, seasons, profile, push, auth)
  errors.ts           — error-mapping conventions (see below)
  waitingOnYou.ts      — shared inbox-count logic (header badge + /inbox page)
  supabase/{server,client,admin}.ts — per-request / browser / service-role Supabase clients
components/
  ui/          — palette-driven atoms (Button, Card, Logo, StackedLogo, CountdownTimer, ...)
  markets/     — MarketCard, MarketActions, MarketForms, OddsBar, SubjectPicker, ...
  groups/      — CreateGroupForm, SettingsActions, IntermissionActions, LeaveGroupButton, ...
  pwa/         — PushSetup (subscribe/unsubscribe + iOS install walkthrough)
supabase/
  migrations/*.sql          — full schema, RLS, and every SECURITY DEFINER function
  functions/send-push/      — Deno Edge Function that drains the notification queue
tests/integration/          — Vitest, run against the real hosted Supabase project
public/
  manifest.json, sw.js      — PWA manifest + hand-rolled service worker
  icon-*.png, badge-mono.png — app icons (incl. maskable) and the Android status-bar badge
```

## Data model

Postgres enums define the closed vocabularies for the state machines:

- `market_type`: `yes_no` | `over_under` | `multiple_choice`
- `market_status`: `pending_sponsor` → `open` → `closed` → `proposed` → (`disputed`) → `resolved` | `voided`
- `bet_side`: `yes` | `no` | `over` | `under` (what you actually bet/vote/propose on for `yes_no`/`over_under` markets — `multiple_choice` uses an `option_id` instead, see below)
- `market_outcome`: `bet_side` + `void` (what a `yes_no`/`over_under` market resolves to, or a proposer can directly propose; a `multiple_choice` market resolves via `outcome_option_id` instead, leaving `outcome` null unless the result is VOID)
- `ledger_entry_type`: `seed` | `bet` | `payout` | `refund`
- `membership_status`: `active` | `dormant` | `removed`
- `season_status` / `season_length`: season lifecycle and its optional fixed duration

Core tables: `users`, `groups`, `group_settings`, `memberships`, `seasons`, `season_optins`, `season_results`, `markets`, `market_subjects`, `market_options`, `bets`, `ledger`, `resolution_proposals`, `challenges`, `votes`, `push_subscriptions`, `notification_events`.

**Identity is per-group, not global.** `users` carries only `id` (auto-created on first sign-in, no separate claim step) and an unused `display_name`. What you're actually called and @mentioned as is `memberships.nickname` — one member can go by a different nickname in a different group. Set once on `create_group`/`join_group` (required on any path that inserts a brand-new membership row; reactivating a `dormant` row or no-op'ing on an `active` one keeps the existing nickname), changeable later via `update_nickname()`. Unique per group among non-`removed` memberships only, via a partial index (`memberships_group_nickname_unique`) rather than a plain constraint, so a `removed` member's old nickname frees up for someone else while a `dormant` member's stays reserved for them.

`group_settings.timezone` is an owner-set IANA zone name, purely informational: it's shown as a caption next to every "betting closes" field/display so members know what zone the person who set the closing time meant. It does not change how `datetime-local` inputs are interpreted (still the visiting browser's own local time) — there's no way to make that input read an arbitrary zone without real timezone-math, which would be a materially bigger feature.

**Multiple choice markets** add `market_options` (2–10 rows per market: `label` + `sort_order`, enforced in `create_market()`). Every place that used to carry a single `bet_side`/`market_outcome` value grew an `option_id` sibling instead — `bets.option_id`, `markets.outcome_option_id`, `resolution_proposals.proposed_option_id`, `votes.voted_option_id` — with exactly one of each pair ever populated on a given row, enforced by a same-table CHECK constraint (`..._xor_option`). VOID always goes through the original `outcome`/`bet_side` column as the literal `'void'`, never through `option_id` — VOID isn't an option, it's the automatic tie/zero-turnout fallback or an explicit proposal/ballot choice, same as for the other two types. Each option is a single field: plain text, or a leading `@nickname` that `create_market()` resolves against `memberships.nickname` in that group and attaches as the option's one subject (at most one subject per option, by construction — a label either starts with `@` or it doesn't). `market_subjects.option_id` is nullable and stays null for `yes_no`/`over_under` (market-level subjects, unchanged). Privacy stays market-level regardless of option — `is_market_visible()` matches on `market_id` alone, so being @'d in any single option still hides the whole market (seeing any option would reveal the market exists).

### The privacy choke point

Every table that can leak a subject's existence is gated by one function:

```sql
create function is_market_visible(p_market_id uuid, p_user_id uuid default auth.uid())
returns boolean ... security definer as $$
  select exists (
    select 1 from markets m
    join memberships mem on mem.group_id = m.group_id and mem.user_id = p_user_id
    where m.id = p_market_id
      and (
        not exists (select 1 from market_subjects ms where ms.market_id = m.id and ms.user_id = p_user_id)
        or m.status in ('resolved', 'voided')
      )
  );
$$;

create view visible_markets with (security_invoker = true) as
  select m.* from markets m where is_market_visible(m.id, auth.uid());
```

Every RLS policy on `markets`, `market_subjects`, `bets`, `resolution_proposals`, `challenges`, and `votes` calls this same function. `security_invoker = true` on the view is load-bearing — without it, the view would run with the *view owner's* privileges instead of the querying user's. RLS is deny-by-default: no table has a client-facing INSERT/UPDATE/DELETE policy at all. The only way to change money- or market-state is through the SECURITY DEFINER functions below.

A query filtered by RLS that comes back empty always means the same thing to the client — 404, never a distinguishable 403 — whether the row genuinely doesn't exist or you're a hidden subject. `lib/errors.ts`'s `notFoundIfEmpty()` enforces this at every route.

## Postgres functions (the only way to mutate anything)

All are `SECURITY DEFINER`, `SET search_path = public`, and explicitly `REVOKE`d from `public`/`anon` then `GRANT`ed only to `authenticated` (Supabase auto-grants EXECUTE by default, which would otherwise be an over-permissive hole).

- **`create_group` / `join_group` / `remove_member` / `leave_group`** — group membership. Leaving is self-service: it no longer refunds the leaver's own open bets (those stakes stay in their pools and settle normally into the now-dormant membership's balance), but still voids+refunds any market where the leaver is a **subject** (unavoidable — the market's premise left the room). Rejoining a `dormant` membership reactivates it in place with whatever balance is already sitting there — never reseeded; a `removed` membership (owner-initiated only) can never rejoin at all. `remove_member` still refunds the removed member's own open bets (they didn't choose to leave) and additionally rotates the group's invite code in the same transaction, so the removed member's known code is dead going forward. Seeding happens in exactly two places: first-time join, and season start for opted-in members.
- **`create_market` / `sponsor_market`** — a market needs two humans: whoever creates it, and a *different* member who endorses ("sponsors") it before it opens. Unsponsored markets auto-expire after 72h. Subject count is capped at `member_count - 2` (enough non-subject members left for a creator and a separate endorser — both of whom can also bet on it themselves). For `multiple_choice`, `create_market` instead takes an ordered list of 2–10 option strings (plain text, or `@nickname`), and both the creator/sponsor exclusion and the subject-count cap apply to the **union of distinct users resolved across every option** — a nickname can only be @mentioned in one option (checked case-insensitively, so `@dan` and `@Dan` collide even though they're distinct label text).
- **`place_bet`** — locks the market row (serializes against `expire_stale()` concurrently closing it) and the bettor's membership row. A bet can be for any amount from 1 up to the bettor's full current balance (no percentage cap). Dormant members and subjects can't bet. `multiple_choice` bets carry an `option_id` instead of a `side`; a member may hedge across multiple options in the same market.
- **`propose_resolution`** (24h challenge window starts) → **`challenge_resolution`** (moves to a secret ballot) → **`cast_vote`** → **`finalize_market`**.
  - `propose_resolution` may fire while a market is still `open`, not just `closed` — betting locks the instant the proposal commits (the same market-row lock `place_bet` already takes makes this race-safe). `closed_at` records when betting actually locked, independent of `closes_at` (which stays the *latest* possible close), so the UI can show "closed early by proposal." This early-close path emits only `resolution_proposed`, not also `market_closed` — recipients don't need "odds are live" and "a resolution was proposed" as two separate pushes for the same moment. The natural auto-close path (`expire_stale()` reaching `closes_at` with no proposal yet) is unaffected and still emits `market_closed` on its own, since nobody's proposed anything at that point.
  - A vote resolves either when the 24h vote window elapses, *or* the moment every eligible (non-subject, non-removed) member has voted — whichever comes first. `multiple_choice` ballots list every option plus VOID.
  - **Turnout rule**: zero ballots cast, or a tie for first place that *includes* the originally proposed outcome, upholds the proposal instead of voiding — apathy or indecision defaults to what was proposed, so challenging is only worth it if you can actually rally votes against it. A tie that *excludes* the proposal, or an explicit VOID majority, still resolves as **voided** (full refund to everyone) — the group actively disagreed with the proposal but couldn't agree on an alternative.
- **Parimutuel payout** (`finalize_market`, the money-critical core): each winning bet's base payout is `floor(bet.amount * total_pool / winning_pool)`. The leftover "dust" from flooring goes entirely to the single largest winning stake (ties broken by earliest bet, then bet id). This guarantees `sum(payouts) == total_pool` exactly — no tokens created or destroyed. A one-sided market or a winning side with zero bets both fall back to a full refund instead. The winner-filter (`side = v_winning_bet_side OR option_id = v_outcome_option_id`) is a single unified expression across all three market types — exactly one of those two variables is ever non-null for a given resolution, so `multiple_choice` reuses the identical payout/dust code path with no branching.
- **`end_season` / `start_season` / `opt_in_season`** — a season end voids+refunds any still-open markets, snapshots standings to `season_results` (champion, biggest win, worst beat) for the Hall of Fame, and opens an `intermission` for members to opt back in before the next season starts.
- **`expire_stale()`** — the cron entry point. Covers all four timers: 72h unsponsored expiry, market auto-close at `closes_at` (stamping `closed_at`), 24h no-challenge auto-finalize, 24h vote-window auto-finalize, and timed season auto-end.

## Money & the ledger

`ledger` is an append-only, signed log (`seed` / `bet` / `payout` / `refund`) — no client can ever UPDATE or DELETE it. Every balance change writes a matching ledger row in the same transaction that changes `memberships.balance`, so the ledger is always independently reconstructable and auditable.

## Server Actions & error handling

Every mutating action in `lib/actions/*.ts` calls a Postgres RPC and returns an `ActionResult<T>`:

```ts
type ActionResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string };
```

**This is load-bearing, not a style choice.** Next.js redacts any error *thrown* out of a Server Action in production — the client only ever sees a generic message + a digest, never the real text, even for an expected rejection like "betting is not open on this market." Actions must catch the Postgres error and *return* it instead; client components check `result.error` rather than wrapping the call in try/catch. `lib/errors.ts`'s `runRpc()` does this conversion and also strips the internal `invalid_operation:` / `not_found:` style prefix so the user sees plain text, not what looks like an error code.

Read-only Server Components query `visible_markets` and read-only RPCs directly — those still throw/404 via `notFoundIfEmpty()`, since that path isn't subject to the same Server Action redaction.

## Notifications

`notification_events` is an internal queue table (no RLS policies at all — only `service_role` touches it) written transactionally by whichever Postgres function causes a notifiable transition. This is deliberate: several transitions (market auto-close, auto-finalize, auto-end-season) only ever happen via the `expire_stale()` cron job, so hooking notifications into Next.js Server Actions would silently miss most of them. Writing the event *inside* the same Postgres transaction that changed the state means "this happened, exactly once" is transactionally safe, decoupled from "send a push" (network I/O, retryable).

`get_event_recipients(event_id)` is the single choke point for who gets notified: it reuses the same subject-exclusion logic as `is_market_visible`, filters to members with a live `push_subscriptions` row and `notifications_enabled = true`, and excludes the triggering actor (`actor_id`) if there is one. Notably, `finalize_market()`'s actor is just `auth.uid()` — when a voter's ballot auto-finalizes the market in the same request, that's still their session, so they're correctly excluded from the "market resolved" push about their own action; cron-triggered finalizes have no request context, so `auth.uid()` is null and nobody is excluded on that basis. `betting_opened` and `season_ended` are group-scoped (every non-removed member, actor excluded) rather than market-scoped. `impressive_bet` repurposes `actor_id` to mean the opposite of everywhere else: the one person to notify, not the one to exclude — `finalize_market()` sets it to the bettor whose payout just became the group's new all-time-best payout multiple (`payout ÷ amount`, see `get_most_impressive_bet()`), and only they get the push.

A scheduled Supabase Edge Function (`supabase/functions/send-push`, Deno + `web-push`, run every minute via pg_cron + pg_net) drains up to 50 unprocessed events per run, computes recipients, and sends real Web Push notifications. Dead subscriptions (404/410 from the push service) are cleaned up automatically.

Current copy (edit in `supabase/functions/send-push/index.ts`, then `supabase functions deploy send-push --no-verify-jwt`):

| Event | Body |
|---|---|
| Needs endorsement | New market needs endorsement |
| Market opened | New market opened: "{title}" |
| Market closed | Odds are live: "{title}" |
| Resolution proposed | A resolution was proposed: "{title}" |
| Resolution challenged | A challenge has been raised: "{title}" |
| Resolved (subject) | A market about you has just resolved... |
| Resolved (everyone else) | A market has resolved: "{title}" |
| Season ended | Season {number} is over. Run it back? |
| Betting opened | Betting is open. Time to start a market. |
| Impressive bet (to the bettor only) | You just pulled off the biggest underdog win in {group}'s history, {multiple}x on "{title}"! |

## PWA & push

- `public/manifest.json`: `start_url`/`scope` are both `"/"` (not a page that requires auth — Android's install criteria need a reachable start URL), standard + maskable icons.
- Maskable icons must be a full-bleed square with a *solid* background (no transparency, no pre-baked rounded corners) — Android applies its own mask shape at display time, and content needs to sit within the inner ~80% "safe zone." A rounded, padded source image shows up with blank corners once Android's own mask is applied over it.
- The Android push **badge** (small status-bar icon) is a *separate*, dedicated asset (`badge-mono.png`) — Android renders it as a solid-tint silhouette using only the alpha channel, ignoring color entirely. The regular full-color app icon is used for the larger in-notification `icon` field, which platforms that support it still show in color.
- `public/sw.js`: network-first for everything (this app is almost entirely dynamic — a stale cached market page could show wrong odds), with a resilient `Promise.allSettled` app-shell precache so one failed asset can't block install. Bump `CACHE_NAME` whenever `SHELL_URLS` changes.
- iOS never fires `beforeinstallprompt`. `components/pwa/PushSetup.tsx` detects iOS + not-yet-installed and shows a Share → Add to Home Screen walkthrough instead of a broken permission prompt; this triggers automatically, nothing to configure.
- VAPID private key lives only as a Supabase Edge Function secret, never in Next.js env or the client bundle.

## Testing

`npm test` runs Vitest integration tests directly against the real hosted Supabase project — no local Docker/mocks. `tests/integration/helpers/testUsers.ts` creates real users via the admin API, signs each in for a real access token, and every test cleans up everything it created (including any group it made a user own — group ownership has no cascading delete, so cleanup order matters) so nothing leaks into the live project. `setupGroup()` (in `tests/integration/helpers/scenarios.ts`) derives each test user's nickname from their `TestUser.tag`, since every test's `create_group`/`join_group` calls route through it — that's the one place a suite-wide nickname requirement gets satisfied. Covers the full privacy/money acceptance checklist: subject invisibility at every market status, parimutuel conservation under randomized/adversarial bet distributions, notification recipient exclusion, balance-capped bet sizing, season rollover. `tests/integration/markets.multiple_choice.test.ts` covers the same checklist for `multiple_choice`: N-option parimutuel conservation, per-option subject invisibility (and visibility at reveal), the union subject cap, hedged bets across options, and the `bets_side_xor_option` constraint rejecting a bet with both/neither of `side`/`option_id` set. `tests/integration/nicknames.test.ts` covers the nickname model itself: join-time collisions, rejoin preserving the existing nickname, and `update_nickname`'s collision/format/non-member checks.

## Deployment

- **Source**: [github.com/LukeStro47/barbets](https://github.com/LukeStro47/barbets), `main` branch. The Vercel project is Git-connected, so a push to `main` alone triggers a production deploy — `npx vercel --prod` is no longer the deploy step (still useful for a one-off preview deploy from a dirty working tree).
- **Database**: edit/add a file in `supabase/migrations/`, then `npx supabase db push` (applies directly to the linked hosted project — there's no local Docker instance in this setup). Not tied to the Vercel Git deploy; run it yourself whenever a migration lands.
- **Edge Function**: `npx supabase functions deploy send-push --no-verify-jwt` after editing `supabase/functions/send-push/index.ts`. Also not deployed automatically by the Vercel Git integration.
- Production env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) live in the Vercel project settings, not in `.env.local` — Git-triggered builds run on Vercel's servers and never see the local file.
- Vercel and Supabase CLI logins are both stored on-disk globally on this machine (not tied to any particular terminal/Claude session), so any new session can run these commands without re-authenticating.
- Useful one-offs: `npx tsc --noEmit` (typecheck), `npx next build` (production build), `npm test` (full suite).

## Copy conventions

No em dashes in user-facing copy — UI strings, notification text, and the friendly Postgres error messages returned through `runRpc()`. Use a comma, period, or parentheses instead. This does not apply to code comments or this document's own prose.

## Notable design decisions worth remembering

- **404-not-403 everywhere.** A hidden subject and a genuinely nonexistent market must be indistinguishable, at every layer, forever.
- **Business-rule errors return, they don't throw**, specifically inside Server Actions — see the Server Actions section above. This bit us once already (a bet-timing race showed as a raw "server error" instead of friendly copy) before the whole action layer was converted.
- **Ledger is append-only** with no client mutation policy, as defense in depth on top of RLS already blocking it.
- **Subject cap is `member_count - 2`**, not `- 3` — the creator and the endorser are the only two roles that strictly can't overlap with the subject set; both can also bet on their own market, so no third "bettor" role needs reserving. For `multiple_choice`, this cap applies to the union of distinct subjects across every option, not per option.
- **The vote window and challenge window are both 24h**, and a vote auto-finalizes early the moment everyone eligible has voted rather than always waiting out the clock.
- **A resolution proposal can beat the clock.** `propose_resolution` accepts a market that's still `open`, not just `closed` — the instant the proposal commits, betting locks for everyone. `closes_at` stays the *latest* possible close; `closed_at` records when it actually happened, so the UI can distinguish "closed early by proposal" from a normal timeout. There's deliberately no reopen mechanism — a premature proposal that turns out to be wrong just gets challenged and voted VOID like any other bad proposal.
- **Leaving a group no longer refunds your open bets** — only being a market's *subject* forces a void+refund on leave/removal. This closes an exploit where a member could peek at closed-market odds, then leave to claw back a stake they knew was going to lose. A self-service leave goes to `dormant` (rejoinable, balance preserved, never reseeded); an owner-initiated removal goes to `removed` (permanent) and rotates the invite code.
- **Turnout apathy upholds the proposal, it doesn't void.** Before this, a tie or zero-turnout vote always voided the market — which made challenging a free "undo" for a losing bettor betting on the group not bothering to vote. Now the proposal wins a tie it's part of, and wins outright if nobody votes; a tie that excludes the proposal (the group disagreed but couldn't agree on what's true instead) still voids.
- **Multiple choice markets generalize via `option_id`, not a new outcome enum.** Every column that used to hold a `bet_side`/`market_outcome` value grew an `option_id` sibling with a same-table XOR CHECK constraint, so `finalize_market`'s money-critical payout math is one shared code path across all three market types instead of a per-type branch — the one place a bug would be catastrophic stays the one place the logic lives.
- **Nicknames are per-group, not global.** The old design claimed a single global `username` at signup, gating every other action behind that claim. Real usage showed people wanted to go by different names in different friend groups, so identity moved onto `memberships.nickname` (set on join/create, changeable via `update_nickname`) and the claim step disappeared entirely — a profile row is just auto-created on first sign-in.
- **A group's time zone is a display caption, not an input-interpretation feature.** It tells members what zone the person who set a closing time meant; it does not make `datetime-local` inputs read differently per visitor. Revisit this if real usage shows people actually need the input itself to be zone-aware.
- **Adding a new trailing default parameter to a Postgres function does not replace an existing overload — and this has bitten this project four separate times, most recently `update_group_settings` picking up a fourth new parameter across three different features.** A function's identity in Postgres is its argument *type* signature, not its defaults — `CREATE OR REPLACE` with a longer signature creates a second overload alongside the old one, and PostgREST then can't pick a candidate for a call that omits the new parameter (and worse, the error only surfaces the next time someone calls it *without* the new param — a function only ever touched with the new signature looks completely fine until then). Every signature change needs an explicit `DROP FUNCTION <old signature>` for the superseded version in the *same migration* that adds the parameter, not a "add first, drop unlisted the moment it breaks" approach. After pushing, verify with a throwaway call passing every parameter by name (`supabase.rpc(name, {...all params...})`) — if PostgREST error-message-dumps two candidate signatures, an overload was left behind.
