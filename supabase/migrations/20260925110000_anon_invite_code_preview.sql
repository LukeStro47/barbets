-- get_invite_code_preview: 5o's signed-out invite preview. `/join/[code]` today
-- redirects a genuinely signed-out visitor straight to `/login` before showing
-- them anything at all -- get_group_by_invite_code() can't be the fix, same
-- reasoning invite_code_exists() was built on: it's authenticated-only on
-- purpose, since an account is the only non-spoofable identity this app has
-- to rate-limit code-guessing against.
--
-- Deliberately narrow: group name, avatar, and member count only -- no market
-- content. A market's title/question is only ever visible to actual group
-- members (is_market_visible() is the app's one privacy choke point for
-- exactly that), and a signed-out preview showing real market questions to
-- anyone holding a 4-character code would be a new, real crack in that wall.
-- Confirmed deliberately narrower than the design's own 5o mock, which shows
-- two open markets with countdowns.
--
-- Same IP-based rate limit invite_code_exists() already established (see
-- 20260814110000's own comment on why IP instead of account, and its
-- documented weaknesses) -- reuses the same _enforce_invite_code_ip_rate_limit
-- / _record_invite_code_ip_miss helpers rather than a second limiter.
create or replace function get_invite_code_preview(p_invite_code text)
returns table (group_name citext, avatar_key text, member_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  perform _enforce_invite_code_ip_rate_limit();

  select * into v_group from groups where invite_code = p_invite_code::citext;

  if v_group.id is null then
    perform _record_invite_code_ip_miss();
    return;
  end if;

  return query
  select v_group.name, v_group.avatar_key, count(*)::int
  from memberships m
  where m.group_id = v_group.id and m.status in ('active', 'dormant');
end;
$$;

revoke execute on function get_invite_code_preview(text) from public;
revoke execute on function get_invite_code_preview(text) from authenticated;
grant execute on function get_invite_code_preview(text) to anon;
