-- pipeline_settings: a platform-wide kill switch, one row per auto-generated market pipeline
-- (Sports, Weather). Follows app_admins's convention for a small, platform-scope table: RLS on,
-- zero policies -- only SECURITY DEFINER functions and the pipelines' own service-role Edge
-- Functions ever touch it. Not group_settings's shape (member-readable) since this isn't
-- member-facing at all.
--
-- Seeds both pipelines disabled: nothing should post a real market with no human in the loop
-- until an admin deliberately flips it on, after a dry run against real API responses.
create table pipeline_settings (
  pipeline text primary key check (pipeline in ('sports', 'weather')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table pipeline_settings enable row level security;

insert into pipeline_settings (pipeline, enabled) values ('sports', false), ('weather', false);

-- set_pipeline_enabled / list_pipeline_settings: same is_platform_admin() gate as every other
-- admin-console action (send_admin_broadcast, create_public_group).
create function set_pipeline_enabled(p_pipeline text, p_enabled boolean)
returns pipeline_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row pipeline_settings%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  update pipeline_settings
  set enabled = p_enabled, updated_at = now()
  where pipeline = p_pipeline
  returning * into v_row;

  if v_row.pipeline is null then
    raise exception 'not_found: unknown pipeline';
  end if;

  return v_row;
end;
$$;

revoke execute on function set_pipeline_enabled(text, boolean) from public;
grant execute on function set_pipeline_enabled(text, boolean) to authenticated;

create function list_pipeline_settings()
returns setof pipeline_settings
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query select * from pipeline_settings order by pipeline;
end;
$$;

revoke execute on function list_pipeline_settings() from public;
grant execute on function list_pipeline_settings() to authenticated;
