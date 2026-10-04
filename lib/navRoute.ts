export type NavTab = 'home' | 'markets' | 'inbox' | 'group' | 'you';

/** The last group the viewer was inside, written by BottomNav on every in-group route and read by
 *  /profile, so You always has a group to be about (not only after an in-app visit to one). */
export const LAST_GROUP_COOKIE = 'bb_last_group';

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

/** The bar only appears on the five top-level destinations the design draws it on: the
 * all-groups hub (4q), a group's market list (4a/4b), its leaderboard (4f/4r), the Inbox (4j), and
 * You (4k). Every other screen is a drill-in with its own back/close header (ScreenHeader) and,
 * often, its own sticky footer CTA — the mockups never stack the nav under either. */
export function shouldHideBottomNav(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/groups' || path === '/inbox' || path === '/profile') return false;
  const groupId = getRouteGroupId(path);
  if (groupId) {
    const rest = path.slice(`/groups/${groupId}`.length);
    if (rest === '' || rest === '/leaderboard') return false;
  }
  return true;
}

/** Routes whose whole state is an unsaved draft, so a pull-to-refresh would silently throw the
 * user's typing away rather than re-fetching anything useful. */
export function shouldDisablePullToRefresh(pathname: string): boolean {
  return isCreateFlow(pathname);
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
  if (pathname === '/inbox') return 'inbox';

  const groupId = getRouteGroupId(pathname);
  if (!groupId) return null;

  const rest = pathname.slice(`/groups/${groupId}`.length);
  // Member records (and their head-to-head comparison) are only ever reached from the
  // leaderboard/awards pages, never from a market — so the bar should stay on Group rather
  // than falling through to the generic Markets default. Settings lives under the same tab
  // now that the group bar (GroupBar.tsx) owns the switcher instead of linking to Settings.
  if (
    rest.startsWith('/leaderboard') ||
    rest.startsWith('/awards') ||
    rest.startsWith('/members') ||
    rest.startsWith('/settings') ||
    rest.startsWith('/seasons') ||
    rest.startsWith('/recap')
  )
    return 'group';
  return 'markets';
}

/** Which of the viewer's memberships a group-scoped page that isn't under /groups/[id] (You, Edit
 *  profile) is about: `?group=` when the nav passes it, else the last group they were in (the
 *  LAST_GROUP_COOKIE BottomNav writes), else their earliest. One rule for both pages, so the
 *  pencil on You always opens Edit profile on the same group You was showing. */
export function pickCurrentMembership<T extends { group_id: string }>(
  rows: T[],
  groupParam: string | null | undefined,
  lastGroup: string | null | undefined
): T | null {
  return rows.find((m) => m.group_id === groupParam) ?? rows.find((m) => m.group_id === lastGroup) ?? rows[0] ?? null;
}
