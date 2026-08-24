'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import type { GroupTitleRow, TitleKey } from '@/lib/titles';

/** Renames/re-icons one of the 4 default titles. A blank label or iconKey resets that field back
 *  to the code default (TITLE_META's label / defaultIconKey) — same convention as custom awards,
 *  just against the fixed titles instead of a group-configured row. */
export async function renameGroupTitle(
  groupId: string,
  titleKey: TitleKey,
  label: string,
  iconKey: string
): Promise<ActionResult<GroupTitleRow>> {
  const supabase = await createClient();
  const result = await runRpc<GroupTitleRow>(
    await supabase.rpc('rename_group_title', {
      p_group_id: groupId,
      p_title_key: titleKey,
      p_label: label,
      p_icon_key: iconKey,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/awards`);
  return result;
}
