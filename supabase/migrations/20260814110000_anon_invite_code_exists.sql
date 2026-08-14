-- /join/[code] used to redirect a signed-out visitor straight to /login before ever checking
-- whether the code matched anything -- so a mistyped code walked someone through the whole
-- sign-in/sign-up flow only to be told afterward that it was never real. get_group_by_invite_code()
-- can't be the fix for that: it's authenticated-only on purpose, because an account is the only
-- non-spoofable identity this app has to rate-limit code-guessing against, and it also hands back
-- the group's name and avatar, which shouldn't be revealed to a visitor who hasn't signed in.
--
-- invite_code_exists() is a narrower, anon-callable sibling: it only ever answers true/false, and
-- it's rate-limited by IP instead of by account, since there's no auth.uid() yet for an anonymous
-- caller. That's the first anon-callable function in this app (see the file that revokes/grants
-- around _client_ip below for why) and the first RLS-relevant Postgres function whose caller isn't
-- authenticated.
--
-- The IP comes from the x-forwarded-for header PostgREST exposes as a GUC. Two things make this
-- weaker than the account-based limiter, both accepted deliberately:
--   1. app/join/[code]/page.tsx sets x-forwarded-for explicitly to the real visitor's IP before
--      calling this function, because the RPC call itself originates from our own Next.js server,
--      not the browser -- without that, every anonymous visitor going through the app would share
--      one bucket keyed to Vercel's own outbound IP, and one person's mistyped codes could lock out
--      everyone else. Supabase's gateway is expected to append its own perceived peer as a further
--      entry rather than overwrite what we send, so the first entry (what split_part below reads)
--      stays the value we set.
--   2. Nothing stops a caller who skips the app and hits PostgREST directly from sending their own
--      forged x-forwarded-for header, so this is friction against casual scripted guessing, not a
--      hard guarantee -- the same trade-off Supabase's own rate-limiting guide makes for this exact
--      pattern. The stakes are low: this function only ever returns a boolean, never the group's
--      name, so the worst a forged IP buys is a few more yes/no checks against a four-character,
--      roughly 1.4M-code keyspace.
create table invite_code_ip_attempts (
  ip text primary key,
  miss_count int not null default 0,
  window_ends_at timestamptz not null
);

-- Same zero-policy shape as invite_code_attempts: RLS on, no policy, so no `anon` or `authenticated`
-- caller can read or write it directly.
alter table invite_code_ip_attempts enable row level security;

create function _client_ip()
returns text
language sql
stable
as $$
  select nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), '');
$$;

create function _enforce_invite_code_ip_rate_limit()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := _client_ip();
  v_row invite_code_ip_attempts%rowtype;
  v_wait_minutes int;
begin
  -- No header (a direct psql/service-role call, or a proxy that strips it) means there's nothing
  -- to key the bucket on -- skip rather than block every header-less caller together.
  if v_ip is null then
    return;
  end if;

  select * into v_row from invite_code_ip_attempts where ip = v_ip;
  if v_row.ip is null or v_row.window_ends_at <= now() or v_row.miss_count < 10 then
    return;
  end if;

  v_wait_minutes := greatest(1, ceil(extract(epoch from (v_row.window_ends_at - now())) / 60))::int;
  raise exception 'invalid_operation: too many invite code tries, wait % minute% and try again',
    v_wait_minutes, case when v_wait_minutes = 1 then '' else 's' end;
end;
$$;

-- Must never be followed by a RAISE in the same transaction, or the increment is rolled back with it.
create function _record_invite_code_ip_miss()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := _client_ip();
begin
  if v_ip is null then
    return;
  end if;

  insert into invite_code_ip_attempts (ip, miss_count, window_ends_at)
  values (v_ip, 1, now() + interval '1 hour')
  on conflict (ip) do update set
    miss_count = case when invite_code_ip_attempts.window_ends_at > now() then invite_code_ip_attempts.miss_count + 1 else 1 end,
    window_ends_at = case when invite_code_ip_attempts.window_ends_at > now() then invite_code_ip_attempts.window_ends_at else now() + interval '1 hour' end;
end;
$$;

revoke execute on function _client_ip() from public;
revoke execute on function _client_ip() from authenticated, anon;
revoke execute on function _enforce_invite_code_ip_rate_limit() from public;
revoke execute on function _enforce_invite_code_ip_rate_limit() from authenticated, anon;
revoke execute on function _record_invite_code_ip_miss() from public;
revoke execute on function _record_invite_code_ip_miss() from authenticated, anon;

-- VOLATILE plpgsql for the same reason get_group_by_invite_code is: PostgREST runs a STABLE
-- function in a read-only transaction, which would fail outright against the miss-counter write.
create function invite_code_exists(p_invite_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  perform _enforce_invite_code_ip_rate_limit();

  select exists(select 1 from groups where invite_code = p_invite_code::citext) into v_exists;

  if not v_exists then
    perform _record_invite_code_ip_miss();
  end if;

  return v_exists;
end;
$$;

revoke execute on function invite_code_exists(text) from public;
revoke execute on function invite_code_exists(text) from authenticated;
grant execute on function invite_code_exists(text) to anon;
