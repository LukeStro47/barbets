-- Admin-only platform stats and group listing, both gated on is_platform_admin().
-- These deliberately go through SECURITY DEFINER functions rather than the
-- service-role client (lib/supabase/admin.ts), which is reserved only for
-- things literally impossible via SQL (Storage bucket bypass, deleting an
-- auth.users row) — an aggregate count across the whole platform is
-- ordinary data access, just gated, exactly what SECURITY DEFINER is for.

create function get_platform_admin_stats()
returns table (active_groups bigint, total_markets bigint, total_users bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  select
    (select count(*) from groups where deletion_scheduled_at is null),
    (select count(*) from markets),
    (select count(*) from users);
end;
$$;

revoke execute on function get_platform_admin_stats() from public;
grant execute on function get_platform_admin_stats() to authenticated;

create function list_groups_for_admin()
returns table (id uuid, name text, member_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  select g.id, g.name, count(m.user_id) filter (where m.status <> 'removed')
  from groups g
  left join memberships m on m.group_id = g.id
  group by g.id, g.name
  order by g.name;
end;
$$;

revoke execute on function list_groups_for_admin() from public;
grant execute on function list_groups_for_admin() to authenticated;
