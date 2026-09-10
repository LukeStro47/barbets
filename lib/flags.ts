/** Hand-flipped toggles for temporarily hiding a feature without touching every call site. Flip
    the value back, nothing else changes. */

/** Hides the reveal ticket's "Share" button and the profile record card's "Share record" button.
    The underlying capture/share plumbing in lib/shareImage.ts is untouched, just not rendered. */
export const SHARE_BUTTONS_ENABLED = false;

/** Hides the story-sized cards' share buttons: the resolved market's "called it" card and every
    card of a season's Wrapped (components/share/StoryCard.tsx). Deliberately its own toggle rather
    than a second reader of SHARE_BUTTONS_ENABLED: that flag was flipped off with no recorded
    reason, and tying the new cards to it would ship them dark and untestable on device. Both
    ride the same lib/shareImage.ts plumbing, so if whatever hid the older two buttons applies to
    these too, this is the one line to flip. The cards themselves (the preview, the Wrapped
    overlay) stay visible either way; only the share/save control is gated. */
export const STORY_CARDS_ENABLED = true;
