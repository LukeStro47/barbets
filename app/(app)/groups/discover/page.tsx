import Link from 'next/link';
import { requireUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { DiscoverGroupCard } from '@/components/groups/DiscoverGroupCard';
import { CaretLeftIcon } from '@/components/ui/icons';
import { listPublicGroups } from '@/lib/actions/discover';
import { isHomeSurfacePublicGroup, publicGroupSettlesCopy } from '@/lib/publicGroups';
import { numberWordCapitalized } from '@/lib/formatNumber';

/**
 * The browse-and-instant-join directory — a handful of always-on groups anyone can join right
 * away, no invite code or friend required. Fixes the "new user has nothing to try" problem: this
 * is the one group listing in this app that isn't gated by membership (see list_public_groups()).
 *
 * Scoped to the sports/weather pipeline groups only (see isHomeSurfacePublicGroup()) — a
 * 'campus' public group, if one ever exists, isn't browsable here.
 */
export default async function DiscoverGroupsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const result = await listPublicGroups();
  const groups = (result.data ?? []).filter(isHomeSurfacePublicGroup);

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

  return (
    <main className="mx-auto max-w-lg px-5">
      <div className="flex items-center pt-[22px]">
        <Link
          href={all ? '/groups?all=1' : '/groups'}
          className="-ml-1 inline-flex items-center gap-0.5 text-[12.5px] font-bold text-espresso-400 hover:text-espresso-600"
        >
          <CaretLeftIcon className="h-4 w-4 text-espresso-300" />
          Back
        </Link>
      </div>

      <div className="flex flex-col gap-[18px] py-[14px] pb-8">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-espresso-950">Public groups</h1>
          <p className="mt-[3px] text-[13px] text-espresso-500">
            {groups.length === 0
              ? 'Nothing open right now.'
              : `${numberWordCapitalized(groups.length)} ${groups.length === 1 ? 'table' : 'tables'} open to anyone. Join instantly, no invite needed.`}
          </p>
        </div>

        {groups.length === 0 ? (
          <EmptyState icon="🔍" title="Nothing open right now" subtitle="Check back soon." />
        ) : (
          <div className="flex flex-col gap-[18px]">
            {groups.map((g) => (
              <DiscoverGroupCard
                key={g.id}
                variant="expanded"
                groupId={g.id}
                name={g.name}
                avatarKey={g.avatar_key}
                memberCount={g.member_count}
                openMarketCount={g.open_market_count}
                featuredMarketTitle={g.featured_market_title}
                featuredMarketBetCount={g.featured_market_bet_count}
                settlesCopy={publicGroupSettlesCopy(g.name)}
                joined={joinedGroupIds.has(g.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
