import type { ReactionEmoji } from '@/lib/actions/reactions';

/** Canonical display order for the 6 fixed reactions — shared by the interactive picker (ReactionBar) and any view-only display (market list facepiles). */
export const REACTIONS: { emoji: ReactionEmoji; glyph: string }[] = [
  { emoji: 'fire', glyph: '🔥' },
  { emoji: 'laugh', glyph: '😂' },
  { emoji: 'clown', glyph: '🤡' },
  { emoji: 'salute', glyph: '🫡' },
  { emoji: 'thumbs_up', glyph: '👍' },
  { emoji: 'thumbs_down', glyph: '👎' },
];
