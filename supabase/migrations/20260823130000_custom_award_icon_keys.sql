-- Custom awards used to take a free-typed emoji for their icon. Every other
-- award-ish thing in this app (the fixed 8 titles' AwardGlyph, group logos,
-- and now user avatar presets) is a symbol *chosen from a fixed set*, not
-- typed freehand — the freeform emoji field was the odd one out, and typing
-- an arbitrary string there had no visual consistency with anything else on
-- the Awards page. This makes a custom award pick one of a fixed set of
-- glyphs too (lib/customAwardIcons.ts), so the column is renamed to match
-- what it actually holds now: a stable icon key, shape-checked exactly like
-- groups.avatar_key and users.avatar_preset_key, not a raw emoji character.
alter table custom_group_titles rename column emoji to icon_key;
alter table custom_group_titles add constraint custom_group_titles_icon_key_check check (icon_key ~ '^[a-z0-9-]{1,32}$');

-- Postgres refuses to rename an input parameter via CREATE OR REPLACE FUNCTION
-- ("cannot change name of input parameter") even when the type list is
-- identical — the type signature staying the same isn't enough, the names
-- have to match too. This is the DROP-then-CREATE case CLAUDE.md's hard rule
-- already warns about, just triggered by a rename (p_emoji -> p_icon_key)
-- rather than an added parameter.
drop function create_custom_group_title(uuid, text, text, custom_title_metric, text);

create function create_custom_group_title(
  p_group_id uuid,
  p_label text,
  p_icon_key text,
  p_metric custom_title_metric,
  p_direction text
) returns custom_group_titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_label text;
  v_icon_key text;
  v_count int;
  v_title custom_group_titles%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can create an award';
  end if;

  if p_direction not in ('asc', 'desc') then
    raise exception 'invalid_operation: direction must be asc or desc';
  end if;

  v_label := nullif(trim(p_label), '');
  if v_label is null then
    raise exception 'invalid_operation: award name can''t be blank';
  end if;
  if length(v_label) > 30 then
    raise exception 'invalid_operation: award name must be 30 characters or fewer';
  end if;

  v_icon_key := nullif(trim(coalesce(p_icon_key, '')), '');
  if v_icon_key is null then
    raise exception 'invalid_operation: pick a symbol for the award';
  end if;
  if v_icon_key !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'invalid_operation: that is not a valid symbol';
  end if;

  select count(*) into v_count from custom_group_titles where group_id = p_group_id;
  if v_count >= 5 then
    raise exception 'invalid_operation: a group can have at most 5 custom awards';
  end if;

  insert into custom_group_titles (group_id, label, icon_key, metric, direction, created_by)
  values (p_group_id, v_label, v_icon_key, p_metric, p_direction, v_caller)
  returning * into v_title;

  insert into custom_group_title_holders (custom_title_id) values (v_title.id);

  perform _compute_custom_title(v_title.id);

  return v_title;
end;
$$;

-- DROP FUNCTION wipes any grants the old function had, unlike CREATE OR
-- REPLACE (which preserves them) — has to be reissued explicitly here.
revoke execute on function create_custom_group_title(uuid, text, text, custom_title_metric, text) from public;
grant execute on function create_custom_group_title(uuid, text, text, custom_title_metric, text) to authenticated;
