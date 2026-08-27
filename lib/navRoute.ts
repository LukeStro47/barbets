export type NavTab = 'home' | 'markets' | 'board' | 'you';

/** Pure, framework-free pathname parsing shared by BottomNav (the fixed bar) and
 * BottomNavSpacer (the bottom scroll padding) — kept in one place so the two can't
 * silently disagree about which routes count as "in a group" or "hide the bar". */

/** The two full-screen create wizards. They're a self-contained multi-step form rather than a view
 * of server data, which is why they both hide the bottom bar (there is nowhere to navigate to
 * mid-flow) and opt out of pull-to-refresh (there is nothing to re-fetch, and now that they're
 * sized to fit the viewport they sit at scrollY 0 permanently, which is exactly the condition
 * that arms the gesture). */
export function isCreateFlow(pathname: string): boolean {
  if (pathname === '/groups/new') return true;
  if (/^\/groups\/[^/]+\/markets\/new/.test(pathname)) return true;
  return false;
}

/** Only the full-screen create flows hide the bar — a market's detail/reveal page keeps it
 * visible (BetslipBar stacks itself just above it, see --bottomnav-height in globals.css). */
export function shouldHideBottomNav(pathname: string): boolean {
  return isCreateFlow(pathname);
}

/** Routes whose whole state is an unsaved draft, so a pull-to-refresh would silently throw the
 * user's typing away rather than re-fetching anything useful. Broader than `isCreateFlow` on
 * purpose: the group settings editor holds a draft too, but unlike the create wizards it is an
 * ordinary scrolling page that keeps the bottom bar, so the two conditions can't be the same one. */
export function shouldDisablePullToRefresh(pathname: string): boolean {
  return isCreateFlow(pathname) || /^\/groups\/[^/]+\/settings\/edit\/?$/.test(pathname);
}

/** The groupId a route is scoped to, or null when the route isn't under a specific group
 * (the all-groups hub, /groups/new, /profile, admin/feedback, ...). */
export function getRouteGroupId(pathname: string): string | null {
  const match = pathname.match(/^\/groups\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return match[1] === 'new' ? null : match[1];
}

/** The one route `@modal` intercepts (see `app/(app)/@modal/(.)groups/[groupId]/members/
 * [membershipId]`) — a same-app tap on a name opens it as a centered dialog over whatever page
 * is already showing, rather than replacing that page's content. The URL still changes to this
 * path, though, which matters to anything keying off `usePathname()` for real page-to-page
 * transitions (see PageTransition): opening/closing this dialog is not one of those. */
export function isMemberProfileModalRoute(pathname: string): boolean {
  return /^\/groups\/[^/]+\/members\/[^/]+\/?$/.test(pathname);
}

export function getActiveNavTab(pathname: string): NavTab | null {
  if (pathname === '/profile') return 'you';
  if (pathname === '/groups') return 'home';

  const groupId = getRouteGroupId(pathname);
  if (!groupId) return null;

  const rest = pathname.slice(`/groups/${groupId}`.length);
  // Member records (and their head-to-head comparison) are only ever reached from the
  // leaderboard/awards pages, never from a market — so the bar should stay on Board rather
  // than falling through to the generic Markets default.
  if (rest.startsWith('/leaderboard') || rest.startsWith('/awards') || rest.startsWith('/members')) return 'board';
  return 'markets';
}
