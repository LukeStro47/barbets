export type NavTab = 'home' | 'markets' | 'board' | 'you';

/** Pure, framework-free pathname parsing shared by BottomNav (the fixed bar) and
 * BottomNavSpacer (the bottom scroll padding) — kept in one place so the two can't
 * silently disagree about which routes count as "in a group" or "hide the bar". */

/** Only the full-screen create flows hide the bar — a market's detail/reveal page keeps it
 * visible (BetslipBar stacks itself just above it, see --bottomnav-height in globals.css). */
export function shouldHideBottomNav(pathname: string): boolean {
  if (pathname === '/groups/new') return true;
  if (/^\/groups\/[^/]+\/markets\/new/.test(pathname)) return true;
  return false;
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
