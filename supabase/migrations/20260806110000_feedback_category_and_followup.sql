-- Lets a feedback submission carry a category, a follow-up request, and (when submitted from
-- inside a group) which group it's about — all surfaced in the Slack message.

create type feedback_category as enum ('bug', 'idea', 'general');

alter table feedback add column category feedback_category not null default 'general';
alter table feedback add column wants_followup boolean not null default false;
alter table feedback add column group_id uuid references groups (id) on delete set null;

-- Per the codebase's own documented overload gotcha: adding parameters changes the function's
-- identity, so the old signature is dropped explicitly rather than left for CREATE OR REPLACE to
-- orphan (a same-signature call elsewhere would silently keep hitting the old one otherwise).
drop function if exists submit_feedback(text, text);

create function submit_feedback(
  p_message text,
  p_category feedback_category,
  p_wants_followup boolean default false,
  p_page_url text default null,
  p_group_id uuid default null
)
returns feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_message text := trim(p_message);
  v_group_id uuid := p_group_id;
  v_row feedback%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_found: unauthenticated';
  end if;

  if v_message = '' then
    raise exception 'invalid_operation: feedback can''t be blank';
  end if;
  if length(v_message) > 2000 then
    raise exception 'invalid_operation: keep feedback under 2000 characters';
  end if;

  -- A client-derived group id (parsed from whatever page they were on) that doesn't actually
  -- match a real membership just gets dropped rather than rejecting the whole submission — a
  -- stale/wrong group tag shouldn't block someone from sending feedback.
  if v_group_id is not null and not exists (
    select 1 from memberships where group_id = v_group_id and user_id = v_user_id
  ) then
    v_group_id := null;
  end if;

  insert into feedback (user_id, message, page_url, category, wants_followup, group_id)
  values (v_user_id, v_message, nullif(trim(coalesce(p_page_url, '')), ''), p_category, p_wants_followup, v_group_id)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function submit_feedback(text, feedback_category, boolean, text, uuid) from public;
grant execute on function submit_feedback(text, feedback_category, boolean, text, uuid) to authenticated;
