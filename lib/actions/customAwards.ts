'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import type { CustomGroupTitle, CustomTitleDirection, CustomTitleMetric } from '@/lib/customAwards';

export async function createCustomGroupTitle(
  groupId: string,
  input: { label: string; emoji: string; metric: CustomTitleMetric; direction: CustomTitleDirection }
): Promise<ActionResult<CustomGroupTitle>> {
  const supabase = await createClient();
  const result = await runRpc<CustomGroupTitle>(
    await supabase.rpc('create_custom_group_title', {
      p_group_id: groupId,
      p_label: input.label,
      p_emoji: input.emoji,
      p_metric: input.metric,
      p_direction: input.direction,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/awards`);
  return result;
}

export async function deleteCustomGroupTitle(groupId: string, id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('delete_custom_group_title', { p_id: id }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/awards`);
  return result;
}
