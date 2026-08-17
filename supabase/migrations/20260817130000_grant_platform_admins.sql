-- Grant platform-admin access to three more users, same mechanism as the
-- original admin (20260805160000_admin_role_schema.sql): a plain insert by
-- email lookup against auth.users. app_admins has zero policies and no
-- app-facing grant path by design, so this is the only way in.
insert into app_admins (user_id)
select id from auth.users where email in (
  'jaket.goldman@gmail.com',
  'jkarch04@gmail.com',
  'chanceheinold@gmail.com'
)
on conflict do nothing;
