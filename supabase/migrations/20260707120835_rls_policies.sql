-- Policies for every table whose visibility depends on is_market_visible()
-- (defined in the previous migration). All are SELECT-only: markets,
-- market_subjects, bets, resolution_proposals, challenges, and votes carry
-- no client INSERT/UPDATE/DELETE policy anywhere in this project — every
-- state transition (create, sponsor, bet, propose, challenge, vote,
-- finalize) happens exclusively through the SECURITY DEFINER functions in
-- Phase 2, which re-check eligibility (subject exclusion, membership,
-- market status) on every call rather than trusting RLS alone for writes.

create policy markets_select on markets for select
  to authenticated
  using (is_market_visible(id));

create policy market_subjects_select on market_subjects for select
  to authenticated
  using (is_market_visible(market_id));

-- Own bets are always visible to the bettor (needed for the "sealed" open
-- market UI: "your bets" + a total count, no one else's amounts/sides).
-- Other members' individual bets only become visible once the market is
-- resolved or voided — is_market_visible() already returns true for
-- resolved/voided markets regardless of subject status, so this compound
-- condition correctly withholds other bettors' rows while a market is only
-- open/closed/proposed/disputed, even from non-subjects.
create policy bets_select on bets for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      is_market_visible(market_id)
      and exists (
        select 1 from markets m
        where m.id = bets.market_id and m.status in ('resolved', 'voided')
      )
    )
  );

-- Proposals and challenges are not secret — everyone who can see the market
-- needs to see a pending proposal in order to decide whether to challenge
-- it, and a challenge itself is an observable state change (proposed ->
-- disputed), not a secret ballot.
create policy resolution_proposals_select on resolution_proposals for select
  to authenticated
  using (is_market_visible(market_id));

create policy challenges_select on challenges for select
  to authenticated
  using (is_market_visible(market_id));

-- Votes are the actual secret ballot: a voter can always see their own vote
-- (so the UI can show "you voted"), but nobody's vote — including their own
-- relative to others' — is visible in aggregate until are_votes_revealed()
-- flips true at tally time.
create policy votes_select on votes for select
  to authenticated
  using (
    voter_id = auth.uid()
    or (is_market_visible(market_id) and are_votes_revealed(market_id))
  );
