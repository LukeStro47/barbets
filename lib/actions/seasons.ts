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
  status: 'active' | 'intermission' | 'archived';
  seed_amount: number | null;
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
  return result;
}

export async function optInSeason(groupId: string, seasonId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('opt_in_season', { p_season_id: seasonId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/intermission`);
  return result;
}
