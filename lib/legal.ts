/**
 * Bump this whenever the Terms of use or Privacy policy content changes in a way that needs
 * existing users to explicitly re-agree, not just silently be bound by the "continued use" clause
 * both app/terms/page.tsx and app/privacy/page.tsx carry. A signed-in user whose
 * users.accepted_policy_version doesn't match this gets PolicyReapprovalGate
 * (components/legal/PolicyReapprovalGate.tsx) blocking every page in app/(app) until they tap
 * through it, mirroring the checkbox already required at signup. A plain copy tweak doesn't need
 * a bump; a change to what's actually being agreed to does.
 *
 * One shared version for both documents, not one each, since the signup checkbox and this gate
 * both already treat "Terms of use and Privacy policy" as a single agreement rather than two.
 */
export const CURRENT_POLICY_VERSION = '2026-08-27';
