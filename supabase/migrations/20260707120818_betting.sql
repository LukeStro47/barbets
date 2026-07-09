create table bets (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  user_id uuid not null references users (id),
  side bet_side not null,
  amount int not null check (amount >= 1),
  -- populated by finalize_market()/refund_all_bets(): the exact amount this
  -- bet receives back (stake + winnings, or a straight refund). Null until
  -- the market is finalized.
  payout int check (payout is null or payout >= 0),
  created_at timestamptz not null default now()
  -- "side must match market_type" (yes/no vs over/under) is cross-table
  -- (needs markets.market_type), so it's enforced in place_bet() (Phase 2),
  -- not as a static check here.
);

-- Append-only balance ledger. amount is signed so that a membership's
-- current balance always equals seed_amount-at-join + sum(ledger.amount) for
-- that membership — this is what the Phase 3 conservation tests check.
-- Negative for money leaving a balance ('bet'), positive for money entering
-- it ('seed', 'payout', 'refund').
create table ledger (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships (id) on delete cascade,
  amount int not null check (amount <> 0),
  reason ledger_entry_type not null,
  market_id uuid references markets (id),
  bet_id uuid references bets (id),
  created_at timestamptz not null default now(),

  constraint ledger_seed_has_no_market_or_bet check (
    (reason = 'seed' and market_id is null and bet_id is null)
    or (reason <> 'seed' and market_id is not null and bet_id is not null)
  ),
  constraint ledger_sign_matches_reason check (
    (reason = 'bet' and amount < 0)
    or (reason in ('seed', 'payout', 'refund') and amount > 0)
  )
);

alter table bets enable row level security;
alter table ledger enable row level security;

-- bets: visibility depends on is_market_visible() (own bets always visible;
-- others' bets only once the market is resolved/voided and visible) — real
-- policies live in 20260707120835_rls_policies.sql, once that function
-- exists. RLS-enabled-with-no-policy denies all access until then.

-- ledger is simple own-rows-only, no dependency on the privacy predicate,
-- so its policy is defined here alongside the table.
create policy ledger_select_own on ledger for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.id = ledger.membership_id and m.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy is granted to any client role — the ledger
-- is written only by SECURITY DEFINER functions (Phase 2). Explicit REVOKEs
-- below are defense-in-depth in case a permissive policy is ever added by
-- mistake later.
revoke insert, update, delete on ledger from authenticated;
revoke insert, update, delete on ledger from anon;
