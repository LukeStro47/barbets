import type { PublicGroup } from '@/lib/actions/discover';

/** The hub's "Open to anyone" section and the rebuilt /groups/discover both stay scoped to the
    always-on, staff-run sports pipeline groups — 'campus' (school-specific) groups are reachable
    only via the "Request this group" form on the browse page, not this surface. See
    ARCHITECTURE.md's "Public groups" section for why. Pure helpers, kept out of
    lib/actions/discover.ts: that file is 'use server', where every export must be an async
    Server Action. */
export function isHomeSurfacePublicGroup(g: PublicGroup): boolean {
  return g.category === 'generic';
}

/** Fixed, staff-known copy for how the pipeline actually settles — NFL/CFB resolve once their one
    weekly game ends. Matched by name the same way the pipeline notification code already does
    (see ARCHITECTURE.md's Public groups section) rather than a schema field, since these two
    specific groups are the only ones this copy is written for. */
export function publicGroupSettlesCopy(name: string): string {
  if (name === 'NFL' || name === 'CFB') return 'settles weekly';
  return 'settles once resolved';
}
