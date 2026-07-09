create table markets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  -- null when the group runs continuously with seasons off.
  season_id uuid references seasons (id),
  title text not null,
  description text not null,
  market_type market_type not null,
  line numeric,
  creator_id uuid not null references users (id),
  sponsor_id uuid references users (id),
  closes_at timestamptz not null,
  status market_status not null default 'pending_sponsor',
  outcome market_outcome,
  actual_value numeric,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint markets_line_required_for_over_under check (
    (market_type = 'yes_no' and line is null)
    or (market_type = 'over_under' and line is not null)
  ),
  constraint markets_actual_value_only_over_under check (
    actual_value is null or market_type = 'over_under'
  ),
  constraint markets_actual_value_only_after_resolution check (
    actual_value is null or status in ('resolved', 'voided')
  ),
  constraint markets_resolved_requires_outcome check (
    status <> 'resolved' or (outcome is not null and resolved_at is not null)
  ),
  constraint markets_terminal_requires_resolved_at check (
    status not in ('resolved', 'voided') or resolved_at is not null
  ),
  constraint markets_sponsor_not_creator check (
    sponsor_id is null or sponsor_id <> creator_id
  )
);

-- Zero, one, or many subjects per market. Creator-not-subject, sponsor-not-subject,
-- the "< group members - 2" subject-count cap, and "all subjects are active
-- members" are cross-table and membership-count-dependent rules, so they're
-- enforced inside create_market()/sponsor_market() (Phase 2), not here.
create table market_subjects (
  market_id uuid not null references markets (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  primary key (market_id, user_id)
);

alter table markets enable row level security;
alter table market_subjects enable row level security;

-- Deliberately no SELECT/INSERT/UPDATE/DELETE policies here yet: visibility
-- for these two tables depends on is_market_visible(), defined once the
-- privacy-predicate migration runs. RLS-enabled-with-no-policy denies all
-- access in the meantime, which is the correct safe default — see
-- 20260707120835_rls_policies.sql for the actual policies.
