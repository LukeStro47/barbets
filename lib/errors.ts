import { notFound } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Every SECURITY DEFINER function in the database raises errors with a
 * `<code>: <message>` convention (see the Postgres migrations). This is the
 * single place that convention gets translated into HTTP-shaped meaning —
 * the discipline that keeps "market doesn't exist" and "market exists but
 * you're a hidden subject" indistinguishable all the way to the client.
 */
export type ActionErrorCode = 'not_found' | 'forbidden' | 'invalid_operation' | 'insufficient_balance' | 'unknown';

export class ActionError extends Error {
  code: ActionErrorCode;
  status: 404 | 403 | 422;

  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = code === 'not_found' ? 404 : code === 'forbidden' ? 403 : 422;
  }
}

const KNOWN_CODES: ActionErrorCode[] = ['not_found', 'forbidden', 'invalid_operation', 'insufficient_balance'];

export function toActionError(error: PostgrestError | Error | null): ActionError {
  const message = error?.message ?? 'Unknown error';
  const prefix = message.split(':')[0].trim() as ActionErrorCode;
  const code = KNOWN_CODES.includes(prefix) ? prefix : 'unknown';
  return new ActionError(code, message);
}

/**
 * Awaits a Supabase RPC call and either returns its data (unwrapped from
 * the single-row-as-array shape Postgres functions returning a row type
 * come back as) or throws an ActionError. Every server action funnels its
 * RPC call through this so error mapping never has to be repeated.
 */
export async function unwrapRpc<T>(result: { data: T | T[] | null; error: PostgrestError | null }): Promise<T> {
  if (result.error) {
    throw toActionError(result.error);
  }
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return data as T;
}

/**
 * For Server Component reads: a query filtered by RLS that comes back
 * empty means either "doesn't exist" or "exists but hidden from you" —
 * always the same 404, never a distinguishable error. Call this instead of
 * letting an empty/null result render as a blank or generic error page.
 */
export function notFoundIfEmpty<T>(data: T | T[] | null): T {
  if (data === null || (Array.isArray(data) && data.length === 0)) {
    notFound();
  }
  return (Array.isArray(data) ? data[0] : data) as T;
}

/**
 * Next.js redacts any error thrown out of a Server Action in production —
 * the client only ever sees a generic "An error occurred" message and a
 * digest, never the real text, even for an expected business-rule
 * rejection like "betting is not open on this market". So Server Actions
 * must never let an ActionError propagate as a throw; they return one of
 * these instead, and the calling client code checks `.error` rather than
 * catching an exception.
 */
export type ActionResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

/** Strips the internal `code: ` prefix (e.g. "invalid_operation: ") and capitalizes the rest, so the client shows plain human copy instead of what looks like an internal error code. */
function friendlyMessage(err: ActionError): string {
  const rest = err.code === 'unknown' ? err.message : err.message.slice(err.code.length + 1).trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export async function runRpc<T>(result: { data: T | T[] | null; error: PostgrestError | null }): Promise<ActionResult<T>> {
  if (result.error) {
    return { error: friendlyMessage(toActionError(result.error)) };
  }
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return { data: data as T };
}
