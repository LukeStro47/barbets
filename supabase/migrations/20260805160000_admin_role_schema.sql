-- Platform-level admin role. Nothing like this existed before now — the only
-- authority model anywhere else in this app is per-group groups.owner_id.
-- app_admins is deliberately RLS-locked with zero policies (same posture as
-- notification_events): no client role can read or write it directly, only
-- SECURITY DEFINER functions and migrations touch it.
create table app_admins (
  user_id uuid primary key references users (id) on delete cascade
);

alter table app_admins enable row level security;

-- The one choke point every admin-gated function and page calls first.
create function is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = p_user_id);
$$;

revoke execute on function is_platform_admin(uuid) from public;
grant execute on function is_platform_admin(uuid) to authenticated;

insert into app_admins (user_id)
select id from auth.users where email = 'lukestrong47@gmail.com'
on conflict do nothing;
