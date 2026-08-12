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

/** The groupId a route is scoped to, or null when the route isn't under a specific group
 * (the all-groups hub, /groups/new, /profile, admin/feedback, ...). */
export function getRouteGroupId(pathname: string): string | null {
  const match = pathname.match(/^\/groups\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return match[1] === 'new' ? null : match[1];
}

export function getActiveNavTab(pathname: string): NavTab | null {
  if (pathname === '/profile') return 'you';
  if (pathname === '/groups') return 'home';

  const groupId = getRouteGroupId(pathname);
  if (!groupId) return null;

  const rest = pathname.slice(`/groups/${groupId}`.length);
  if (rest.startsWith('/leaderboard') || rest.startsWith('/awards')) return 'board';
  return 'markets';
}
