-- Printed cards all point at the same fixed mybarbets.com/go/card URL (reprinting isn't an
-- option), but NFC tags handed out at specific events get their own batch, e.g. /go/rutgers.
-- Both need to actually show up somewhere durable: barbets-www promised no analytics SDKs, so
-- this is a first-party log line into our own database instead, called from the /go/[batch]
-- route in the barbets-www repo with nothing but the anon key (no session exists at that point;
-- a scan happens before anyone has installed anything).
--
-- Same shape as invite_code_exists(): a narrow anon-callable function, not a client-facing table
-- policy. qr_scans keeps RLS enabled with zero policies, so anon/authenticated have no direct
-- read or write access to it at all -- only log_qr_scan() can insert, and nothing can select.
create table qr_scans (
  id bigint generated always as identity primary key,
  batch text not null,
  platform text not null check (platform in ('android', 'ios', 'other')),
  country text,
  region text,
  created_at timestamptz not null default now()
);

alter table qr_scans enable row level security;

create index qr_scans_batch_created_at_idx on qr_scans (batch, created_at);

-- VOLATILE (not the PostgREST default STABLE) because it writes.
create function log_qr_scan(p_batch text, p_platform text, p_country text default null, p_region text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into qr_scans (batch, platform, country, region)
  values (left(p_batch, 64), p_platform, left(p_country, 8), left(p_region, 64));
end;
$$;

-- Same two-step lockdown every anon-callable function in this codebase uses: Supabase's project
-- bootstrap grants anon its own standing EXECUTE on every new function, separate from PUBLIC, so
-- revoking from PUBLIC alone would still leave this callable. See 20260814120000 for the incident
-- that made this the required pattern rather than a style preference.
revoke execute on function log_qr_scan(text, text, text, text) from public;
revoke execute on function log_qr_scan(text, text, text, text) from authenticated;
grant execute on function log_qr_scan(text, text, text, text) to anon;
