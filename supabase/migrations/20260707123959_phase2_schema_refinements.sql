-- Three refinements surfaced while designing the Phase 2 functions, all
-- additive/safe since no application data exists yet.

-- 1. "Changes to token allocation and cap take effect at the next season"
-- (spec) requires the running season to be insulated from mid-season edits
-- to group_settings. Snapshot the values onto the season row itself at the
-- moment a season actually starts; group_settings stays the single
-- "currently configured, takes effect once a new season starts" source of
-- truth. Null while a season is only 'intermission' (not yet started, so
-- not yet snapshotted) — start_season() fills these in.
alter table seasons add column seed_amount int check (seed_amount is null or seed_amount > 0);
alter table seasons add column bet_cap_pct int check (bet_cap_pct is null or bet_cap_pct between 1 and 100);
alter table seasons add constraint seasons_active_requires_snapshot check (
  status = 'intermission' or (seed_amount is not null and bet_cap_pct is not null)
);

-- 2. A bet can be settled two ways: the normal market-wide finalize/refund
-- path, or an early individual refund when its bettor is removed from the
-- group mid-market (remove_member(), Phase 2) without voiding the whole
-- market. settled_at distinguishes "already paid out or refunded" from
-- "still an active stake in the pool" independent of what payout ends up
-- being (0 is a valid settled payout for a losing bet).
alter table bets add column settled_at timestamptz;
alter table bets add constraint bets_payout_requires_settled check (
  (settled_at is null and payout is null) or (settled_at is not null)
);

-- 3. A 'removed' member (added in the previous migration) must lose all
-- access to the group going forward — the privacy predicate and every
-- membership-scoped SELECT policy need to stop treating a 'removed' row as
-- proof of current access. This only affects the CALLER's own status (i.e.
-- whether *they* can still see the group), not whether other, still-active
-- members can see that a removed member once existed — that history stays
-- visible to the group for leaderboard/audit purposes.

create or replace function is_market_visible(p_market_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from markets m
    join memberships mem
      on mem.group_id = m.group_id and mem.user_id = p_user_id and mem.status <> 'removed'
    where m.id = p_market_id
      and (
        not exists (
          select 1 from market_subjects ms
          where ms.market_id = m.id and ms.user_id = p_user_id
        )
        or m.status in ('resolved', 'voided')
      )
  );
$$;

alter policy groups_select on groups using (
  exists (
    select 1 from memberships m
    where m.group_id = groups.id and m.user_id = auth.uid() and m.status <> 'removed'
  )
);

alter policy group_settings_select on group_settings using (
  exists (
    select 1 from memberships m
    where m.group_id = group_settings.group_id and m.user_id = auth.uid() and m.status <> 'removed'
  )
);

alter policy memberships_select on memberships using (
  exists (
    select 1 from memberships mine
    where mine.group_id = memberships.group_id and mine.user_id = auth.uid() and mine.status <> 'removed'
  )
);

alter policy seasons_select on seasons using (
  exists (
    select 1 from memberships m
    where m.group_id = seasons.group_id and m.user_id = auth.uid() and m.status <> 'removed'
  )
);

alter policy season_optins_select on season_optins using (
  exists (
    select 1 from seasons s
    join memberships m on m.group_id = s.group_id
    where s.id = season_optins.season_id and m.user_id = auth.uid() and m.status <> 'removed'
  )
);

alter policy season_results_select on season_results using (
  exists (
    select 1 from memberships m
    where m.group_id = season_results.group_id and m.user_id = auth.uid() and m.status <> 'removed'
  )
);
