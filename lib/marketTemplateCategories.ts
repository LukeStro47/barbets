/** The fixed set of curated-template categories, in the order they render on the gallery.
    Editable freely (rename, reorder, add) -- same "the app-authored list decides what renders"
    shape as lib/avatars.ts. Category rows in market_templates carry the slug as plain text, not
    an enum, so adding one here never needs a migration. An unrecognized/null slug groups under
    "Other" rather than being dropped. */
export const MARKET_TEMPLATE_CATEGORIES = [
  { slug: 'bar', label: 'Bar' },
  { slug: 'party', label: 'Party' },
  { slug: 'trip', label: 'Trip' },
  { slug: 'work', label: 'Work' },
] as const;

export type MarketTemplateCategorySlug = (typeof MARKET_TEMPLATE_CATEGORIES)[number]['slug'];

export function categoryLabel(slug: string | null): string {
  return MARKET_TEMPLATE_CATEGORIES.find((c) => c.slug === slug)?.label ?? 'Other';
}
