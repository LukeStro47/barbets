# Barbets — instructions for agents

## Read ARCHITECTURE.md first

`ARCHITECTURE.md` at the repo root is the canonical description of how this app works — data model, the privacy choke point, every Postgres function, money rules, notifications, PWA/push, deployment, and a "notable design decisions" section explaining *why* the non-obvious choices were made. Read it before any non-trivial change. It is actively maintained and is more current than any summary of it.

## Keep ARCHITECTURE.md current — this is part of the change, not a chore

**If your change makes anything in ARCHITECTURE.md wrong, incomplete, or silent, update the doc in the same change.** Don't defer it, don't ask whether the user wants it, don't leave it as a suggested follow-up. Say in your summary that you updated it.

Update it when you:

- add/rename/remove a Postgres function, table, column, enum value, or RLS policy
- add a `notification_events` event type or change push copy (the doc's copy table must match `supabase/functions/send-push/index.ts`)
- add a top-level route, a `lib/actions/*.ts` file, or a `lib/*.ts` module (reflect it in the structure tree)
- change a money rule, a privacy rule, or anything touching `is_market_visible()`
- add an authority model, access gate, or external integration
- make a decision where the obvious approach turned out to be wrong — that goes in "Notable design decisions worth remembering," **with the reasoning**, since the why is the part that can't be recovered from the code later
- notice the doc is already wrong about something — fix it then and there

Skip it for purely mechanical changes (copy tweaks, styling, no-behavior refactors). Rule of thumb: if a new contributor would be surprised by it, or you'd have to read three files to re-derive it, document it.

## Hard rules that predate any single task

- **404, never 403.** A hidden market subject and a nonexistent market must be indistinguishable at every layer. Reads use `notFoundIfEmpty()`; RPCs raise `not_found` identically for both cases.
- **Business-rule errors return, they don't throw** — inside Server Actions specifically. Next.js redacts thrown Server Action errors in production, so the user would see a generic message instead of "betting is not open on this market." Use `runRpc()` and have the client check `result.error`.
- **All mutation goes through SECURITY DEFINER Postgres functions.** RLS is deny-by-default with no client-facing INSERT/UPDATE/DELETE policy on any table. Don't add one.
- **Changing a Postgres function's parameters requires an explicit `DROP FUNCTION <old signature>` in the same migration.** `CREATE OR REPLACE` with a new trailing parameter creates a *second* overload rather than replacing the first, and PostgREST then can't choose between them — which breaks call sites that omit the new parameter, not the one you just wrote and tested. This has bitten the project repeatedly; see the doc's note for the catalog query that detects leftovers.
- **No em dashes in user-facing copy** — UI strings, push notification text, and the friendly error messages returned through `runRpc()`. Use a comma, period, or parentheses. Code comments and ARCHITECTURE.md prose are exempt.

## Commands

- `npm test` — Vitest integration tests against the **real hosted Supabase project** (no mocks, no local Docker). Tests create and clean up real users.
- `npx tsc --noEmit` — typecheck. `npx next build` — production build.
- `npx supabase db push` — apply migrations to the linked hosted project.
- `npx supabase functions deploy send-push --no-verify-jwt` — after editing the Edge Function.
- A push to `main` triggers the Vercel production deploy; migrations and the Edge Function are **not** deployed by it and must be pushed separately.
