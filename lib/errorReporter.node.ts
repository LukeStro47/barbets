import { inspect } from 'node:util';

/**
 * The source-mapped rendering of an error, which is the only way to get one out of Next.js.
 *
 * `error.stack` is deliberately NOT source-mapped: Next sets
 * `Error.prepareStackTrace = prepareUnsourcemappedStackTrace` on startup
 * (`next/dist/server/patch-error-inspect.js`), so no amount of
 * `process.setSourceMapsEnabled(true)` will change what `.stack` returns - an explicit
 * `prepareStackTrace` override always wins over Node's own source-map support. Instead Next
 * installs a `Symbol.for('nodejs.util.inspect.custom')` handler on `Error.prototype` that does
 * the mapping at inspect time. `util.inspect(error)` triggers it; reading `.stack` does not.
 *
 * Nothing else is needed to make this work. The maps are already emitted by default (236 files
 * in a stock `next build` on 16.2 with Turbopack), so `experimental.serverSourceMaps` buys
 * nothing, and neither does enabling Node's source-map support. Both were tried against a
 * production build and measured; this line is the whole fix.
 *
 * That is the difference between a Slack card that says
 *   at g (.next/server/chunks/[root-of-the-server]__0qu39jf._.js:1:1119)
 * and one that says
 *   at g (app/maptest-probe/route.ts:3:19)
 *
 * Node-only, in its own module, dynamically imported behind a NEXT_RUNTIME check:
 * lib/errorReporter.ts is reachable from the edge bundle (instrumentation.ts is bundled for
 * both runtimes), and a static `node:util` import there would break that build.
 */
export function inspectError(error: unknown): string {
  return inspect(error);
}
