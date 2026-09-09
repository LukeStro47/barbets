import { MARKET_TITLE_MAX_LENGTH } from '@/lib/limits';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MemberOption } from '@/components/markets/MarketForms';

/** Pure, framework-free helpers shared by the gallery's "apply a template" path and the
    create-market wizard's "save as template" path -- kept dependency-free so both a Server
    Component and a client modal can import them without pulling in unrelated code, same reason
    lib/units.ts's formatLine()/parseLineInput() live outside any component. */

/** Swaps a template's literal "@" placeholder (in the title, or in exactly one multiple_choice
    option) for a chosen member -- the title gets their nickname as plain text, an option gets
    the resolved "@nickname" syntax create_market() already understands -- and carries them as
    the market's one subject. A template with no placeholder, or applied with nobody chosen,
    passes its fields through untouched with no subject. */
export function applyTemplate(
  template: MarketTemplate,
  chosenMember: MemberOption | null
): {
  title: string;
  description: string;
  options: string[] | null;
  unit: string | null;
  subjectIds: string[];
} {
  if (!template.has_placeholder || !chosenMember) {
    return {
      title: template.title,
      description: template.description,
      options: template.options,
      unit: template.unit,
      subjectIds: [],
    };
  }

  const options = template.options
    ? template.options.map((o) => (o.trim() === '@' ? `@${chosenMember.nickname}` : o))
    : null;

  // The title's placeholder only exists for yes_no/over_under (a multiple_choice template's
  // placeholder lives in its options instead), so a title with no literal "@" left alone here
  // is expected, not a bug.
  let title = template.title.replace('@', chosenMember.nickname);
  if (title.length > MARKET_TITLE_MAX_LENGTH) {
    title = title.slice(0, MARKET_TITLE_MAX_LENGTH);
  }

  return {
    title,
    description: template.description,
    options,
    unit: template.unit,
    subjectIds: [chosenMember.userId],
  };
}

/** Best-effort: proposes swapping the first case-insensitive whole-word occurrence of `nickname`
    in `title` for the literal "@" placeholder. This is a heuristic, not a guarantee -- the save
    flow always shows the result in an editable field rather than saving it silently, since a
    title that never literally names its subject (e.g. "Will they be the first to leave?") simply
    won't match, which is a fine outcome, not an error. */
export function detectPlaceholderInTitle(title: string, nickname: string): { title: string; matched: boolean } {
  const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  if (!pattern.test(title)) {
    return { title, matched: false };
  }
  return { title: title.replace(pattern, '@'), matched: true };
}

/** An `@nickname` option flattened back to plain text -- used when saving a multiple_choice
    market as a template that already has its one placeholder elsewhere: raw "@mention" syntax
    can never be stored in a template row (that syntax is reserved for create_market()'s own
    resolution), so any other @-mentioned option just loses its leading "@" rather than blocking
    the save. */
export function stripLeadingMention(label: string): string {
  return label.startsWith('@') ? label.slice(1) : label;
}
