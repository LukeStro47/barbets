'use server';

import { createClient, requireUser } from '@/lib/supabase/server';
import { getSettledMarkets, type SettledCursor, type SettledPage } from '@/lib/groupFeed';
import type { ActionResult } from '@/lib/errors';

/**
 * "Load more" under the group feed's Settled tab.
 *
 * A read rather than a mutation, so there is no RPC behind it, but it still returns an
 * ActionResult like every other Server Action: a throw out of one is redacted to a generic
 * message in production, and the button needs something it can actually put on screen.
 *
 * No membership check here on purpose. visible_markets is the choke point, and a caller who
 * isn't in the group (or is a hidden subject of everything in it) simply gets an empty page,
 * which is indistinguishable from having reached the end of the list.
 */
export async function loadMoreSettledMarkets(groupId: string, cursor: SettledCursor): Promise<ActionResult<SettledPage>> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  try {
    return { data: await getSettledMarkets(supabase, groupId, user.id, cursor) };
  } catch {
    return { error: 'Could not load more settled markets. Try again.' };
  }
}
