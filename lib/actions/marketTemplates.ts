'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MarketType } from '@/lib/marketType';

export async function saveMarketTemplate(input: {
  groupId: string;
  scope: 'private' | 'group';
  title: string;
  description: string;
  marketType: MarketType;
  options?: string[];
  unit?: string | null;
}): Promise<ActionResult<MarketTemplate>> {
  const supabase = await createClient();
  const result = await runRpc<MarketTemplate>(
    await supabase.rpc('create_market_template', {
      p_scope: input.scope,
      p_group_id: input.scope === 'group' ? input.groupId : null,
      p_title: input.title,
      p_description: input.description,
      p_market_type: input.marketType,
      p_options: input.options ?? null,
      p_unit: input.unit ?? null,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${input.groupId}/markets/templates`);
  return result;
}

export async function deleteMarketTemplate(groupId: string, id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('delete_market_template', { p_id: id }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/templates`);
  return result;
}
