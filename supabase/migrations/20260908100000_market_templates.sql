-- Market templates: a browsable library of ready-made market ideas ("curated",
-- staff-authored) plus the ability to save a market you just composed as a
-- personal ("private") or group-shared ("group") template for a recurring
-- bet. One table for all three, distinguished by `scope`, since they share an
-- identical shape rather than three near-duplicate tables.
--
-- A template can carry at most one literal "@" placeholder (in the title, or
-- as one multiple_choice option) standing in for "whoever this is about" --
-- deliberately distinct from the "@nickname" syntax create_market() already
-- resolves, which never reaches this table. Applying a template is a pure
-- client-side substitution (swap the "@" for a chosen member's nickname, and
-- carry them as a subject) that happens entirely before the existing,
-- unchanged create_market() is ever called -- this migration adds no new
-- market-creation path and does not touch create_market() at all.
--
-- `line` is deliberately not stored: a reused numeric line is more likely
-- stale (thresholds rarely repeat) than a reused unit (e.g. "drinks", which
-- genuinely tends to stay constant), so a template prefills everything about
-- an over/under market except the line itself.
--
-- Curated rows are authored directly via Supabase Studio's table editor for
-- now, not through an app-facing function -- see the "Notable design
-- decisions" entry this same change adds to ARCHITECTURE.md for why.

create table market_templates (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('curated', 'private', 'group')),
  created_by uuid references users (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  -- Curated only; validated app-side against lib/marketTemplateCategories.ts,
  -- not a CHECK constraint -- same reasoning as market title/group name
  -- validation living in create_market()/create_group() rather than a
  -- constraint, and the same "no enum, it's an open vocabulary" call
  -- groups.avatar_key and custom_group_titles.direction already make.
  category text,
  title text not null,
  description text not null default '',
  market_type text not null check (market_type in ('yes_no', 'over_under', 'multiple_choice')),
  -- multiple_choice only; one entry may be the literal '@' placeholder.
  options text[],
  -- over_under only.
  unit text,
  has_placeholder boolean not null default false,
  created_at timestamptz not null default now()
);

create index market_templates_curated_category_idx on market_templates (category) where scope = 'curated';
create index market_templates_private_owner_idx on market_templates (created_by) where scope = 'private';
create index market_templates_group_idx on market_templates (group_id) where scope = 'group';

alter table market_templates enable row level security;

-- No client-facing write policy at all -- mutation goes through the two
-- SECURITY DEFINER functions below, same posture as every other table.
create policy market_templates_select on market_templates for select
  to authenticated
  using (
    scope = 'curated'
    or (scope = 'private' and created_by = (select auth.uid()))
    or (
      scope = 'group'
      and exists (
        select 1 from memberships m
        where m.group_id = market_templates.group_id
          and m.user_id = (select auth.uid())
          and m.status <> 'removed'
      )
    )
  );

-- Counts literal '@' placeholders across a template's title and options,
-- distinguishing a standalone '@' from an '@nickname'-shaped fragment (that
-- syntax belongs only to create_market()'s own resolution and should never
-- reach this table).
create function _count_template_placeholders(p_title text, p_options text[])
returns int
language sql
immutable
set search_path = public
as $$
  select
    (select count(*) from regexp_matches(coalesce(p_title, ''), '@(?![A-Za-z0-9])', 'g'))
    + coalesce((select count(*) from unnest(coalesce(p_options, '{}')) as o where trim(o) = '@'), 0);
$$;

revoke execute on function _count_template_placeholders(text, text[]) from public;
revoke execute on function _count_template_placeholders(text, text[]) from authenticated;
revoke execute on function _count_template_placeholders(text, text[]) from anon;

-- Validation mirrors create_market()'s own checks (140-char title, 2-10
-- options for multiple_choice, 40-char option labels, unique/non-blank
-- labels, unit only for over_under) so a saved template can never later fail
-- create_market() for something this step could have caught.
create function create_market_template(
  p_scope text,
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type text,
  p_options text[] default null,
  p_unit text default null
) returns market_templates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_title text;
  v_unit text;
  v_placeholder_count int;
  v_option_count int;
  v_existing_count int;
  v_row market_templates%rowtype;
begin
  if p_scope not in ('private', 'group') then
    raise exception 'invalid_operation: templates can only be saved as private or shared with a group';
  end if;

  if p_scope = 'private' and p_group_id is not null then
    raise exception 'invalid_operation: a private template has no group';
  end if;

  if p_scope = 'group' then
    if p_group_id is null then
      raise exception 'invalid_operation: pick a group to share this with';
    end if;
    perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
    if not found then
      raise exception 'not_found: group not found';
    end if;
  end if;

  if p_market_type not in ('yes_no', 'over_under', 'multiple_choice') then
    raise exception 'invalid_operation: unknown market type';
  end if;

  v_title := nullif(trim(p_title), '');
  if v_title is null then
    raise exception 'invalid_operation: a template needs a title';
  end if;
  if length(v_title) > 140 then
    raise exception 'invalid_operation: title must be 140 characters or fewer';
  end if;

  if p_market_type = 'multiple_choice' then
    v_option_count := coalesce(array_length(p_options, 1), 0);
    if v_option_count < 2 or v_option_count > 10 then
      raise exception 'invalid_operation: multiple choice templates need between 2 and 10 options';
    end if;
    if exists (select 1 from unnest(p_options) as o where trim(o) = '') then
      raise exception 'invalid_operation: option labels cannot be blank';
    end if;
    if exists (select 1 from unnest(p_options) as o where length(trim(o)) > 40) then
      raise exception 'invalid_operation: option labels must be 40 characters or fewer';
    end if;
    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;
    if exists (select 1 from unnest(p_options) as o where trim(o) ~ '^@[A-Za-z0-9]') then
      raise exception 'invalid_operation: an option can be plain text or the @ placeholder, not an @mention';
    end if;
  elsif p_options is not null then
    raise exception 'invalid_operation: options only apply to multiple choice templates';
  end if;

  v_unit := nullif(trim(coalesce(p_unit, '')), '');
  if v_unit is not null then
    if p_market_type <> 'over_under' then
      raise exception 'invalid_operation: a unit only applies to over/under templates';
    end if;
    if length(v_unit) > 10 then
      raise exception 'invalid_operation: unit must be 10 characters or fewer';
    end if;
  end if;

  v_placeholder_count := _count_template_placeholders(v_title, p_options);
  if v_placeholder_count > 1 then
    raise exception 'invalid_operation: a template can only have one @ placeholder';
  end if;

  select count(*) into v_existing_count from market_templates
  where scope = p_scope
    and (
      (p_scope = 'private' and created_by = v_caller)
      or (p_scope = 'group' and group_id = p_group_id)
    );
  if v_existing_count >= 30 then
    raise exception 'invalid_operation: this list is full, delete one to save another';
  end if;

  insert into market_templates (scope, created_by, group_id, title, description, market_type, options, unit, has_placeholder)
  values (p_scope, v_caller, p_group_id, v_title, coalesce(trim(p_description), ''), p_market_type, p_options, v_unit, v_placeholder_count = 1)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function create_market_template(text, uuid, text, text, text, text[], text) from public;
revoke execute on function create_market_template(text, uuid, text, text, text, text[], text) from anon;
grant execute on function create_market_template(text, uuid, text, text, text, text[], text) to authenticated;

-- Same two-step (existence, then ownership) shape delete_custom_group_title
-- already uses. No group-owner override to delete someone else's shared
-- template in v1 -- only the original saver can.
create function delete_market_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_row market_templates%rowtype;
begin
  select * into v_row from market_templates where id = p_id and scope in ('private', 'group');
  if v_row.id is null then
    raise exception 'not_found: template not found';
  end if;

  if v_row.scope = 'group' then
    perform 1 from memberships where group_id = v_row.group_id and user_id = v_caller and status <> 'removed';
    if not found then
      raise exception 'not_found: template not found';
    end if;
  end if;

  if v_row.created_by <> v_caller then
    raise exception 'forbidden: only whoever saved this can delete it';
  end if;

  delete from market_templates where id = p_id;
end;
$$;

revoke execute on function delete_market_template(uuid) from public;
revoke execute on function delete_market_template(uuid) from anon;
grant execute on function delete_market_template(uuid) to authenticated;
