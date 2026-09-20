-- Market banter (DESIGN 4e Comments tab). Threaded comments on a market, gated by
-- is_market_visible() the same way as every other subject-sensitive table: a hidden
-- subject sees nothing until the market resolves, and a non-member sees nothing at all.
-- Mutated only through the SECURITY DEFINER functions below — no client INSERT/UPDATE/DELETE.

create table market_comments (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  -- Nullable so account deletion can set null rather than block (same reasoning as
  -- notification_events.actor_id and the other user FKs audited in 20260823*).
  author_id uuid references users (id) on delete set null,
  parent_id uuid references market_comments (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  -- Soft delete: the row stays so reply threads don't collapse, but body is cleared
  -- and the UI renders a plain "Deleted" stand-in. Author-only via delete_market_comment().
  deleted_at timestamptz
);

create index idx_market_comments_market_created
  on market_comments (market_id, created_at);

create index idx_market_comments_parent
  on market_comments (parent_id)
  where parent_id is not null;

alter table market_comments enable row level security;

create policy market_comments_select on market_comments for select
  to authenticated
  using (is_market_visible(market_id, (select auth.uid())));

-- post_market_comment: one body, optional parent for a single reply. Cap is 500
-- characters after trim (lib/limits.ts MARKET_COMMENT_MAX_LENGTH must match).
create or replace function post_market_comment(
  p_market_id uuid,
  p_body text,
  p_parent_id uuid default null
)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_parent market_comments%rowtype;
  v_body text := trim(coalesce(p_body, ''));
  v_row market_comments%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_found: market not found';
  end if;

  -- Same 404-for-both-cases posture as every other market RPC.
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  perform 1
  from memberships
  where group_id = v_market.group_id
    and user_id = v_user_id
    and status <> 'removed';
  if not found then
    raise exception 'not_found: market not found';
  end if;

  if length(v_body) = 0 then
    raise exception 'invalid_operation: comment cannot be empty';
  end if;

  if length(v_body) > 500 then
    raise exception 'invalid_operation: comment is too long';
  end if;

  if p_parent_id is not null then
    select * into v_parent from market_comments where id = p_parent_id;
    if v_parent.id is null or v_parent.market_id <> p_market_id then
      raise exception 'not_found: comment not found';
    end if;
    if v_parent.deleted_at is not null then
      raise exception 'invalid_operation: cannot reply to a deleted comment';
    end if;
    -- One level of nesting only: replies attach to a top-level comment, never to a reply.
    if v_parent.parent_id is not null then
      raise exception 'invalid_operation: replies can only attach to a top-level comment';
    end if;
  end if;

  insert into market_comments (market_id, author_id, parent_id, body)
  values (p_market_id, v_user_id, p_parent_id, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function post_market_comment(uuid, text, uuid) from public;
grant execute on function post_market_comment(uuid, text, uuid) to authenticated;

-- Soft-delete own comment. Clears body so a deleted row never leaks the original text
-- through a direct select after the author leaves / is removed.
create or replace function delete_market_comment(p_comment_id uuid)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row market_comments%rowtype;
begin
  if v_user_id is null then
    raise exception 'not_found: comment not found';
  end if;

  select * into v_row from market_comments where id = p_comment_id;
  if v_row.id is null then
    raise exception 'not_found: comment not found';
  end if;

  if not is_market_visible(v_row.market_id, v_user_id) then
    raise exception 'not_found: comment not found';
  end if;

  if v_row.author_id is distinct from v_user_id then
    raise exception 'forbidden: only the author can delete this comment';
  end if;

  if v_row.deleted_at is not null then
    return v_row;
  end if;

  update market_comments
  set deleted_at = now(), body = ''
  where id = p_comment_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function delete_market_comment(uuid) from public;
grant execute on function delete_market_comment(uuid) to authenticated;

-- list_market_comments: joins the author's *group* nickname (per-membership identity),
-- never users.display_name. Soft-deleted rows are returned with empty body so the client
-- can keep reply threading intact. Ordered oldest-first for a chat-like scroller.
create or replace function list_market_comments(p_market_id uuid)
returns table (
  id uuid,
  market_id uuid,
  author_id uuid,
  parent_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz,
  author_nickname text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group_id uuid;
begin
  if v_user_id is null or not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select m.group_id into v_group_id from markets m where m.id = p_market_id;
  if v_group_id is null then
    raise exception 'not_found: market not found';
  end if;

  return query
  select
    c.id,
    c.market_id,
    c.author_id,
    c.parent_id,
    case when c.deleted_at is null then c.body else '' end as body,
    c.created_at,
    c.deleted_at,
    mem.nickname as author_nickname
  from market_comments c
  left join memberships mem
    on mem.group_id = v_group_id
   and mem.user_id = c.author_id
   and mem.status <> 'removed'
  where c.market_id = p_market_id
  order by c.created_at asc, c.id asc;
end;
$$;

revoke execute on function list_market_comments(uuid) from public;
grant execute on function list_market_comments(uuid) to authenticated;
