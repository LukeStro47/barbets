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

/** Fixed, staff-known copy for how each pipeline actually settles — Sports resolves per-game
    once a game ends, Weather resolves once a day against that morning's forecast. Matched by
    name the same way the Sports/Weather notification code already does (see
    ARCHITECTURE.md's Public groups section) rather than a schema field, since these two specific
    groups are the only ones this copy is written for. */
export function publicGroupSettlesCopy(name: string): string {
  if (name === 'Sports') return 'settles after each game';
  if (name === 'Weather') return 'settles daily';
  return 'settles once resolved';
}
