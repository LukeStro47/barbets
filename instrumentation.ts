import type { Instrumentation } from 'next';

/**
 * Next.js calls this for every error thrown out of server-side rendering, a
 * Server Action, a route handler or middleware — including the ones the user
 * only ever sees as a redacted digest. It is the single hook that catches
 * everything server-side without a try/catch in each of the ~40 places that
 * could throw.
 *
 * Note what this deliberately does *not* see: a business-rule rejection from a
 * Server Action. Those are returned as `ActionResult.error`, never thrown (see
 * lib/errors.ts) — which means anything that does reach here is by definition
 * unexpected, and the signal-to-noise ratio is high enough that a Slack ping
 * per distinct error is reasonable. `reportError()` filters the two remaining
 * classes of deliberate throw (Next's notFound()/redirect() control flow, and
 * an ActionError raised out of a read path).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportError } = await import('@/lib/errorReporter');
  await reportError({
    error: err,
    source: 'server',
    route: context.routePath || request.path,
    path: request.path,
    method: request.method,
    context: {
      Kind: [context.routerKind, context.routeType].filter(Boolean).join(' '),
      Render: context.renderSource ?? null,
      Revalidate: context.revalidateReason ?? null,
    },
  });
};
