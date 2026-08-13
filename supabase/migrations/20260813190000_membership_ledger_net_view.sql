-- Per-membership "all-time net" as one row, instead of every ledger row.
--
-- Four pages needed the same figure (every ledger entry except the seed,
-- summed) and all four got it the same way: select the raw rows and add them
-- up in JavaScript. That transfers a member's entire lifetime ledger to
-- produce a single number, and it grows for as long as the group is played.
-- The groups hub was the worst case: every non-seed row across every group the
-- viewer belongs to, transferred in order to render one figure per group card.
--
-- A view rather than a SECURITY DEFINER function, on purpose. `security_invoker
-- = true` means the aggregate is computed under the caller's own RLS, so this
-- grants no new visibility whatsoever: it returns exactly the number the
-- JavaScript sum already produced, over exactly the rows the caller could
-- already read. A function would have been a privacy decision wearing a
-- performance costume.
--
-- The consequence worth naming, because the zero it produces looks real:
-- `ledger_select_own` is own-rows-only, so a caller asking for *another*
-- member's row gets net = 0, entry_count = 0 rather than that member's real
-- figures. The code this replaces had exactly the same blind spot (a JS sum
-- over zero visible rows is also 0), so the view neither introduces it nor
-- fixes it. Anything that genuinely needs another member's net has to go
-- through a SECURITY DEFINER function and decide, deliberately, that exposing
-- it is intended.
--
-- entry_count exists for the leaderboard's "did this departed member ever
-- actually play?" check, which needs existence rather than a total: real
-- ledger activity can net to exactly zero, and a bare sum cannot tell that
-- apart from no activity at all.

create or replace view membership_ledger_net
with (security_invoker = true) as
select
  m.id as membership_id,
  m.user_id,
  m.group_id,
  coalesce(sum(l.amount), 0)::bigint as net,
  count(l.id)::bigint as entry_count
from memberships m
left join ledger l on l.membership_id = m.id and l.reason <> 'seed'
group by m.id, m.user_id, m.group_id;

-- left join, not join: a membership with no non-seed activity yet still needs a
-- row (net 0), since every caller wants a figure per membership rather than
-- "absent means zero" handling at each call site.

grant select on membership_ledger_net to authenticated;

-- No new index. The grouping is driven by idx_ledger_membership_created
-- (membership_id, created_at desc), whose leading column is the join key, and
-- every caller filters on user_id / group_id / membership_id, all of which are
-- grouping keys and therefore push below the aggregate.
