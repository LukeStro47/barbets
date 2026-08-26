'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, toActionError, friendlyMessage, type ActionResult } from '@/lib/errors';
import type { Group } from '@/lib/actions/groups';

export async function sendAdminBroadcast(
  groupId: string,
  title: string,
  body: string,
  targetUserId: string | null
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  return runRpc<null>(
    await supabase.rpc('send_admin_broadcast', { p_group_id: groupId, p_title: title, p_body: body, p_target_user_id: targetUserId })
  );
}

export interface CreatePublicGroupResult extends Group {
  /** Any moderator email that didn't match an existing Barbets account — the admin console shows
      these back so the admin knows who to follow up with separately. */
  unresolved_emails: string[];
}

/** Admin-only: spins up a new always-on public group, staff (the calling admin) as owner. Forced
    is_public/awards_enabled/seasons-off/no-hedging/no-endorsement server-side — see
    create_public_group()'s migration. A nickname is optional: passing one is the explicit "I'll
    moderate this group too" opt-in (it makes the admin a seeded, active, role='moderator' member
    alongside their existing owner authority); leaving it out means the admin manages the group
    purely from here, with no membership of their own. moderatorEmails adds each matching Barbets
    account directly as an active, seeded moderator, no join step. */
export async function createPublicGroup(input: {
  name: string;
  category: 'generic' | 'campus';
  seedAmount: number;
  timezone: string;
  nickname?: string | null;
  moderatorEmails?: string[];
}): Promise<ActionResult<CreatePublicGroupResult>> {
  const supabase = await createClient();
  const result = await runRpc<CreatePublicGroupResult>(
    await supabase.rpc('create_public_group', {
      p_name: input.name,
      p_category: input.category,
      p_seed_amount: input.seedAmount,
      p_timezone: input.timezone,
      p_nickname: input.nickname ?? null,
      p_moderator_emails: input.moderatorEmails ?? [],
    })
  );
  if (result.error) return result;
  revalidatePath('/admin');
  revalidatePath('/groups/discover');
  return result;
}

export interface ModeratorCandidate {
  user_id: string;
  nickname: string;
  role: 'member' | 'moderator';
}

/** Admin-only: every active/dormant member of a public group plus their current role, the picker
    behind assignGroupModerator().

    Not routed through runRpc(): it unwraps a result down to its first row, which is right for
    every single-row RPC in this app but wrong for a table-returning one like this — see
    listPublicGroups()'s identical note in lib/actions/discover.ts. */
export async function listGroupModeratorCandidates(groupId: string): Promise<ActionResult<ModeratorCandidate[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_group_moderator_candidates', { p_group_id: groupId });
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as ModeratorCandidate[] };
}

/** Admin-only: flips a public-group member's moderator status. Scoped to public groups — a
    private group's owner already has full authority on their own. */
export async function assignGroupModerator(groupId: string, targetUserId: string, isModerator: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(
    await supabase.rpc('assign_group_moderator', { p_group_id: groupId, p_target_user_id: targetUserId, p_is_moderator: isModerator })
  );
  if (result.error) return result;
  revalidatePath('/admin');
  return result;
}

export interface PipelineSetting {
  pipeline: 'sports' | 'weather';
  enabled: boolean;
  updated_at: string;
}

/** Admin-only: current on/off state of the auto-generated Sports and Weather market pipelines.
    Not routed through runRpc() — table-returning, same note as listGroupModeratorCandidates(). */
export async function listPipelineSettings(): Promise<ActionResult<PipelineSetting[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_pipeline_settings');
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as PipelineSetting[] };
}

/** Admin-only: the kill switch each pipeline's Edge Function checks before creating or resolving
    any market. Seeded off — see 20260826130000_pipeline_settings.sql. */
export async function setPipelineEnabled(pipeline: 'sports' | 'weather', enabled: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('set_pipeline_enabled', { p_pipeline: pipeline, p_enabled: enabled }));
  if (result.error) return result;
  revalidatePath('/admin');
  return result;
}

export interface PipelineHealth {
  pipeline: 'sports' | 'weather';
  job: 'create' | 'resolve';
  last_run_at: string | null;
  last_run_succeeded: number | null;
  last_run_failed: number | null;
  open_failure_count: number;
  last_failure_at: string | null;
  last_failure_message: string | null;
}

/** Admin-only: last-run counts and open sweep_failures for each of the 4 pipeline jobs (sports
    create/resolve, weather create/resolve). Not routed through runRpc() — table-returning, same
    note as listGroupModeratorCandidates(). See 20260828110000_pipeline_health.sql. */
export async function listPipelineHealth(): Promise<ActionResult<PipelineHealth[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_pipeline_health');
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as PipelineHealth[] };
}

export interface QrScanTotal {
  batch: string;
  total_count: number;
  android_count: number;
  ios_count: number;
  other_count: number;
  first_scanned_at: string;
  last_scanned_at: string;
}

/** Admin-only: per-batch scan counts for printed cards and NFC tags, logged by barbets-www's
    /go/[batch] route (a separate repo) via log_qr_scan(). Not routed through runRpc() —
    table-returning, same note as listGroupModeratorCandidates(). See
    20260828150000_list_qr_scan_totals.sql and ARCHITECTURE.md's "Postgres functions" section. */
export async function listQrScanTotals(): Promise<ActionResult<QrScanTotal[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_qr_scan_totals');
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as QrScanTotal[] };
}
