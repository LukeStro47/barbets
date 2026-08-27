import { requireUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { DiscoverGroupCard } from '@/components/groups/DiscoverGroupCard';
import { RequestGroupForm } from '@/components/groups/RequestGroupForm';
import { listPublicGroups } from '@/lib/actions/discover';

const CATEGORY_LABEL: Record<'generic' | 'campus', string> = {
  generic: 'Open to anyone',
  campus: 'Campus groups',
};

/**
 * The browse-and-instant-join directory — a handful of always-on groups anyone can join right
 * away, no invite code or friend required. Fixes the "new user has nothing to try" problem: this
 * is the one group listing in the app that isn't gated by membership (see list_public_groups()).
 */
export default async function DiscoverGroupsPage() {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const result = await listPublicGroups();
  const groups = result.data ?? [];

  // Which of these the viewer is already an active/dormant member of, so the card can read
  // "Joined" instead of offering to join again. A 'left' member still sees "Join" (rejoining is
  // exactly what that button does); a 'removed' one does too, and finds out why not on tap, same
  // as everywhere else in this app.
  const groupIds = groups.map((g) => g.id);
  const { data: myMemberships } =
    groupIds.length > 0
      ? await supabase.from('memberships').select('group_id').eq('user_id', user.id).in('group_id', groupIds).in('status', ['active', 'dormant'])
      : { data: [] };
  const joinedGroupIds = new Set((myMemberships ?? []).map((m) => m.group_id));

  const byCategory = new Map<'generic' | 'campus', typeof groups>();
  for (const g of groups) {
    byCategory.set(g.category, [...(byCategory.get(g.category) ?? []), g]);
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
      <PageHeader title="Browse groups" subtitle={<span className="text-[12.5px] text-espresso-400">Join instantly, no invite needed</span>} />

      <p className="rounded-2xl bg-paper-dim px-3.5 py-3 text-[12.5px] text-espresso-500">
        These are here to help you get a feel for how Barbets works, before you run your own group with friends.
      </p>

      {groups.length === 0 ? (
        <EmptyState icon="🔍" title="Nothing open right now" subtitle="Check back soon, or request a campus group below." />
      ) : (
        (['campus', 'generic'] as const).map((category) => {
          const rows = byCategory.get(category);
          if (!rows || rows.length === 0) return null;
          return (
            <div key={category} className="space-y-2">
              <p className="ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">{CATEGORY_LABEL[category]}</p>
              <div className="flex flex-col gap-2.5">
                {rows.map((g) => (
                  <DiscoverGroupCard
                    key={g.id}
                    groupId={g.id}
                    name={g.name}
                    avatarKey={g.avatar_key}
                    memberCount={g.member_count}
                    joined={joinedGroupIds.has(g.id)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      <RequestGroupForm />
    </main>
  );
}
