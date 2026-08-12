import type { Instrumentation } from 'next';

/**
 * Runs once per server process, before anything else.
 *
 * Node does not apply source maps to `Error.stack` unless asked, so a production stack came
 * back as a single minified frame naming a chunk file and nothing else. Paired with
 * `experimental.serverSourceMaps` in next.config.mjs (which emits the maps), this is what
 * makes the stack in a Slack card point at a real file and line.
 *
 * The call lives in its own Node-only module, reached by dynamic import behind a NEXT_RUNTIME
 * check: this hook is bundled for the edge runtime too, and Turbopack statically flags a
 * `process.setSourceMapsEnabled` reference there as unsupported even when it is unreachable
 * at runtime. The separate file is what keeps it out of the edge bundle entirely.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}

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
