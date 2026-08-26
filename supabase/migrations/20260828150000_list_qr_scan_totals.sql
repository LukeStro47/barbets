-- Admin-only read of qr_scans, aggregated per batch since nobody needs row-level scan data in the
-- UI, just "how many, and on what". qr_scans itself stays exactly as locked down as before (RLS
-- on, zero policies, log_qr_scan() the only write path) -- this is the one read path in, same
-- shape as list_pipeline_health() next to it.
create function list_qr_scan_totals()
returns table (
  batch text,
  total_count bigint,
  android_count bigint,
  ios_count bigint,
  other_count bigint,
  first_scanned_at timestamptz,
  last_scanned_at timestamptz
)
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
    qs.batch,
    count(*) as total_count,
    count(*) filter (where qs.platform = 'android') as android_count,
    count(*) filter (where qs.platform = 'ios') as ios_count,
    count(*) filter (where qs.platform = 'other') as other_count,
    min(qs.created_at) as first_scanned_at,
    max(qs.created_at) as last_scanned_at
  from qr_scans qs
  group by qs.batch
  order by total_count desc;
end;
$$;

revoke execute on function list_qr_scan_totals() from public;
grant execute on function list_qr_scan_totals() to authenticated;
