/**
 * The canonical public origin for the app, for building links that are meant to leave it (invite
 * links someone pastes into a group chat).
 *
 * Deliberately a constant rather than `window.location.origin`. This app answers on more than one
 * hostname: app.mybarbets.com, the barbets.vercel.app deployment alias, and inside the Capacitor
 * WebView whatever `server.url` in capacitor.config.ts currently points at. Deriving the origin
 * from the browser means a shared link says whichever hostname the sharer happened to be on, so
 * every invite an Android user sent was a barbets.vercel.app link.
 *
 * This is only for outbound/shareable URLs. Anything that navigates within the app should stay a
 * relative path, so it keeps working on every hostname (and in the WebView).
 */
export const APP_ORIGIN = 'https://app.mybarbets.com';

/** The marketing site. It owns the canonical privacy policy, terms, and support pages. */
export const SITE_ORIGIN = 'https://mybarbets.com';

/**
 * The public contact address, on the company's own domain. Apple checks that an organization's
 * contact details live at the organization's domain, and a reviewer reading the privacy policy
 * will notice an address that belongs to some other company.
 */
export const CONTACT_EMAIL = 'info@mybarbets.com';

/** Where invite links point. Kept next to APP_ORIGIN so both call sites agree on the shape. */
export function inviteUrl(inviteCode: string): string {
  return `${APP_ORIGIN}/join/${inviteCode}`;
}
