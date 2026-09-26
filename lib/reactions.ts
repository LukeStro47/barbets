export type ReactionEmoji = 'fire' | 'laugh' | 'clown' | 'salute' | 'thumbs_up' | 'thumbs_down';

/** Canonical display order for the 6 fixed reactions — used by the comment reaction picker (CommentRow). Market-level reactions (react_to_market/market_reactions/ReactionBar) were removed; comment reactions are the only surviving use of this set. */
export const REACTIONS: { emoji: ReactionEmoji; glyph: string }[] = [
  { emoji: 'fire', glyph: '🔥' },
  { emoji: 'laugh', glyph: '😂' },
  { emoji: 'clown', glyph: '🤡' },
  { emoji: 'salute', glyph: '🫡' },
  { emoji: 'thumbs_up', glyph: '👍' },
  { emoji: 'thumbs_down', glyph: '👎' },
];
