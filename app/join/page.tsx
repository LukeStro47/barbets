import { createClient } from '@/lib/supabase/server';
import { JoinWithCode } from '@/components/groups/JoinWithCode';

/**
 * 5f, the "Got a group code?" entry point, for someone holding a code but not a link. The code is
 * checked here before moving on (see JoinWithCode), then /join/[code] does the real work,
 * including bouncing a signed-out visitor through sign-up and back to the invite.
 */
export default async function JoinCodePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const startGroupHref = user ? '/groups/new' : `/login?mode=signup&next=${encodeURIComponent('/groups/new')}`;
  return <JoinWithCode startGroupHref={startGroupHref} />;
}
