/**
 * Temporary beta access gate in front of /login. Flip BETA_GATE_ENABLED to
 * false (or delete this file's usages in middleware.ts and lib/actions/betaGate.ts)
 * to remove it entirely — nothing else depends on it.
 */
export const BETA_GATE_ENABLED = false;
export const BETA_GATE_CODE = 'BB-PHIL';
export const BETA_GATE_COOKIE = 'bb_beta_access';
