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

export async function renameSeason(groupId: string, seasonId: string, name: string): Promise<ActionResult<Season>> {
  const supabase = await createClient();
  const result = await runRpc<Season>(await supabase.rpc('rename_season', { p_season_id: seasonId, p_name: name }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}
