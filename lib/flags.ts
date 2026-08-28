/** Hand-flipped toggles for temporarily hiding a feature without touching every call site. Flip
    the value back, nothing else changes. */

/** Hides the reveal ticket's "Share" button and the profile record card's "Share record" button.
    The underlying capture/share plumbing in lib/shareImage.ts is untouched, just not rendered. */
export const SHARE_BUTTONS_ENABLED = false;
