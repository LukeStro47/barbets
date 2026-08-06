-- User feedback, forwarded to Slack by the app layer (lib/actions/feedback.ts) — this table is
-- the durable record, Slack is the delivery channel. RLS-locked with zero client policies, same
-- deny-by-default posture as every other table here (notification_events, app_admins): the only
-- way in is submit_feedback().
create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  message text not null,
  page_url text,
  created_at timestamptz not null default now()
);

alter table feedback enable row level security;

create function submit_feedback(p_message text, p_page_url text default null)
returns feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_message text := trim(p_message);
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

  insert into feedback (user_id, message, page_url)
  values (v_user_id, v_message, nullif(trim(coalesce(p_page_url, '')), ''))
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function submit_feedback(text, text) from public;
grant execute on function submit_feedback(text, text) to authenticated;
