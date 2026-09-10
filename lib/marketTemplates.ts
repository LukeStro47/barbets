import type { MarketType } from '@/lib/marketType';

/** A row from `market_templates`: a curated idea (staff-authored, shared with everyone), a
    private template a user saved for themselves, or one saved and shared with a specific group.
    `has_placeholder` means the title (yes_no/over_under) or exactly one option
    (multiple_choice) carries a literal "@" standing in for a person, swapped for a chosen
    member's nickname before the market is ever created -- see lib/marketTemplatePlaceholder.ts. */
export interface MarketTemplate {
  id: string;
  scope: 'curated' | 'private' | 'group';
  created_by: string | null;
  group_id: string | null;
  category: string | null;
  title: string;
  description: string;
  market_type: MarketType;
  options: string[] | null;
  unit: string | null;
  has_placeholder: boolean;
  created_at: string;
}
