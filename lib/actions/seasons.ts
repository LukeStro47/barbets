'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export interface Season {
  id: string;
  group_id: string;
  number: number;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'winding_down' | 'intermission' | 'archived';
  seed_amount: number | null;
  ends_at: string | null;
  season_length: '1m' | '2m' | '3m' | 'manual' | 'custom' | null;
  betting_open: boolean;
  name: string | null;
}

export async function endSeason(groupId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('end_season', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}

export async function startSeason(groupId: string): Promise<ActionResult<Season>> {
  const supabase = await createClient();
  const result = await runRpc<Season>(await supabase.rpc('start_season', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}

/** For a currently-dormant member (self-service leave, a prior opt-out, or just joined mid-intermission) asking to be swept into this season. */
export async function optInSeason(groupId: string, seasonId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('opt_in_season', { p_season_id: seasonId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}

/** For a currently-active member pre-emptively skipping the next season. */
export async function optOutSeason(groupId: string, seasonId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('opt_out_season', { p_season_id: seasonId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}

/** Undoes optOutSeason. */
export async function cancelSeasonOptout(groupId: string, seasonId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('cancel_season_optout', { p_season_id: seasonId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}

export async function openSeasonBetting(groupId: string, seasonId: string): Promise<ActionResult<Season>> {
  const supabase = await createClient();
  const result = await runRpc<Season>(await supabase.rpc('open_season_betting', { p_season_id: seasonId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  return result;
}

/** Names whichever season is currently running, without the caller having to know its id — what
 * the create-group flow needs, since it collects a name for a season that `create_group()` only
 * brings into existence a moment later. Falls through to `rename_season`, so the same ownership
 * check applies; a group with no active season is a no-op rather than an error, since the only
 * caller is offering the name optionally. */
export async function nameActiveSeason(groupId: string, name: string): Promise<ActionResult<Season | null>> {
  const supabase = await createClient();
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .maybeSingle();
  if (!season) return { data: null };
  return renameSeason(groupId, season.id, name);
}

export async function renameSeason(groupId: string, seasonId: string, name: string): Promise<ActionResult<Season>> {
  const supabase = await createClient();
  const result = await runRpc<Season>(await supabase.rpc('rename_season', { p_season_id: seasonId, p_name: name }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}
