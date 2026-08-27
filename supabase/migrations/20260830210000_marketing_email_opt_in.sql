-- Explicit consent to marketing email, collected at signup. Separate from users.notify_promos
-- (that one already exists and gates *push* marketing, "the app itself talking to you" via
-- admin_broadcast) — this is the same idea over a channel nothing in this app sends through yet.
-- The consent needs to be captured before any such email ever goes out, not retrofitted once it
-- does, so this column exists ahead of any actual email-sending integration.
alter table users add column marketing_email_opt_in boolean not null default false;
alter table users add column marketing_email_opt_in_at timestamptz;

-- Own-row-only, same shape as set_notifications_enabled/update_notification_categories: users has
-- select and insert policies but deliberately no update policy, so a plain `update` would match
-- zero rows and silently report success.
create function update_marketing_email_opt_in(p_opt_in boolean)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_found: unauthenticated';
  end if;

  update users
  set marketing_email_opt_in = coalesce(p_opt_in, false),
      marketing_email_opt_in_at = now()
  where id = auth.uid()
  returning * into v_user;

  return v_user;
end;
$$;

revoke execute on function update_marketing_email_opt_in(boolean) from public;
grant execute on function update_marketing_email_opt_in(boolean) to authenticated;
