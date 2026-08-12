'use server';

import { reportError } from '@/lib/errorReporter';

/**
 * The browser half of error reporting. `instrumentation.ts` covers everything
 * that throws on the server; a React render that blows up in the client (which,
 * in an installed PWA, is most of what a user actually experiences as "the app
 * broke") throws somewhere Next.js can never tell the server about, so
 * `app/global-error.tsx` posts it back through this.
 *
 * A Server Action rather than a route handler purely because that's this app's
 * grammar for "the client asks the server to do something" — it is no more or
 * less reachable by a stranger than a route would be. The abuse ceiling is set
 * in `reportError()` itself, which caps how many reports leave one instance per
 * window regardless of who asked; the truncation here just keeps a hostile
 * payload from filling the channel with one message.
 */
export async function reportClientError(input: {
  name?: string;
  message?: string;
  stack?: string;
  url?: string;
}): Promise<void> {
  const error = new Error(String(input.message ?? 'Unknown client error').slice(0, 1000));
  error.name = String(input.name ?? 'ClientError').slice(0, 100);
  error.stack = input.stack ? String(input.stack).slice(0, 4000) : undefined;

  await reportError({
    error,
    source: 'client',
    route: input.url ? String(input.url).slice(0, 500) : null,
  });
}
