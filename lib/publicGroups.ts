import type { PublicGroup } from '@/lib/actions/discover';

/** The hub's "Open to anyone" section and the rebuilt /groups/discover both stay scoped to the
    always-on, staff-run sports/weather pipeline groups — 'campus' (school-specific) groups are
    reachable only via the "Request this group" form on the browse page, not this surface. See
    ARCHITECTURE.md's "Public groups" section for why. Pure helpers, kept out of
    lib/actions/discover.ts: that file is 'use server', where every export must be an async
    Server Action. */
export function isHomeSurfacePublicGroup(g: PublicGroup): boolean {
  return g.category === 'generic';
}

/** Fixed, staff-known copy for how each pipeline actually settles — NFL/CFB resolve once their
    one weekly game ends, Weather resolves once a day against that morning's forecast. Matched by
    name the same way the pipeline notification code already does (see ARCHITECTURE.md's Public
    groups section) rather than a schema field, since these three specific groups are the only
    ones this copy is written for. */
export function publicGroupSettlesCopy(name: string): string {
  if (name === 'NFL' || name === 'CFB') return 'settles after the game';
  if (name === 'Weather') return 'settles daily';
  return 'settles once resolved';
}

/** The group-feed empty state for a pipeline group between markets — NFL/CFB between one week's
    resolved game and the next Tuesday's drop, Weather between yesterday's resolve and this
    morning's next market. Matched by name for the same reason publicGroupSettlesCopy() is: these
    are the only groups this copy is written for, and there's no schema field worth adding for it.
    Returns null for an ordinary group, which GroupMarketSections treats as "use the default empty
    state" (its own generic "tap the + below to start one" copy). */
export function publicGroupWaitingCopy(name: string): { icon: string; title: string; subtitle: string } | null {
  if (name === 'NFL' || name === 'CFB') {
    return {
      icon: '🏈',
      title: 'The next Game of the Week drops Tuesday morning',
      subtitle: 'NFL and CFB picks go up at the same time.',
    };
  }
  if (name === 'Weather') {
    return {
      icon: '⛅',
      title: "Today's weather market lands this morning",
      subtitle: 'A new city and question rotates in every day.',
    };
  }
  return null;
}
