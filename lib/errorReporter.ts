import 'server-only';

/**
 * Production error tracking, delivered to Slack.
 *
 * Deliberately not a third-party SDK. The app already holds a Slack Incoming
 * Webhook for feedback (`lib/actions/feedback.ts`), and an error report is the
 * same shape of thing: an HTTP POST of a Block Kit card to a URL. A hosted
 * error tracker would add a runtime dependency, a build step, a vendor account
 * and (for Sentry, the obvious candidate) a paid plan for the Slack
 * integration itself, to deliver the same message to the same channel. The
 * pieces that a tracker earns its keep with are grouping, rate limiting and
 * retention; the first two are cheap enough to do here (see below) and the
 * third is what the Slack channel is.
 *
 * Everything about this is best-effort by construction: a failed report is
 * swallowed, never rethrown. Reporting an error must never be able to cause
 * one.
 */

/** Set to a Slack Incoming Webhook URL to turn reporting on. Unset (locally, in CI) it is a no-op. */
const WEBHOOK_URL = process.env.SLACK_ERROR_WEBHOOK_URL;

/**
 * Vercel sets VERCEL_ENV on every deployment; preview builds run with
 * NODE_ENV=production too, so NODE_ENV alone would Slack every branch deploy.
 * Where VERCEL_ENV exists it is the authority, and only 'production' reports.
 */
const IS_PRODUCTION = process.env.VERCEL_ENV
  ? process.env.VERCEL_ENV === 'production'
  : process.env.NODE_ENV === 'production';

/** Same window on both counters below. Serverless means per-instance, which is fine: the point is to
 *  stop one hot loop flooding the channel, not to maintain an exact global count. */
const WINDOW_MS = 10 * 60 * 1000;
/** How many times one distinct error is reported per window before it goes quiet. */
const PER_FINGERPRINT_LIMIT = 3;
/** Ceiling across all fingerprints, so a burst of *different* errors can't flood either. */
const TOTAL_LIMIT = 30;

const seen = new Map<string, { count: number; firstAt: number }>();
let windowStartedAt = 0;
let windowTotal = 0;

export type ErrorSource = 'server' | 'client';

export interface ErrorReport {
  error: unknown;
  source: ErrorSource;
  /** Route pattern where available (e.g. /groups/[groupId]/markets/[marketId]), else the raw path. */
  route?: string | null;
  /** Raw request path, when it differs usefully from the route pattern. */
  path?: string | null;
  method?: string | null;
  /** Free-form extras rendered as a field grid: renderSource, routeType, digest, and so on. */
  context?: Record<string, string | null | undefined>;
}

interface Normalized {
  name: string;
  message: string;
  stack: string | null;
  digest: string | null;
}

function normalize(error: unknown): Normalized {
  if (error instanceof Error) {
    const digest = (error as Error & { digest?: unknown }).digest;
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack ?? null,
      digest: typeof digest === 'string' ? digest : null,
    };
  }
  return { name: 'UnknownThrow', message: typeof error === 'string' ? error : JSON.stringify(error), stack: null, digest: null };
}

/**
 * Next.js implements notFound() and redirect() by throwing, and a few of its
 * internal bail-outs do the same. Those are control flow, not faults, and the
 * app leans on notFound() hard (every 404-never-403 read path calls it). None
 * of them are worth a Slack message.
 */
const CONTROL_FLOW_DIGESTS = ['NEXT_NOT_FOUND', 'NEXT_REDIRECT', 'NEXT_HTTP_ERROR_FALLBACK', 'DYNAMIC_SERVER_USAGE', 'BAILOUT_TO_CLIENT_SIDE_RENDERING'];

/**
 * The other expected throw: `unwrapRpc()` raising a business-rule ActionError
 * from a read path (`not_found`, `forbidden`, ...). Those are the database
 * saying no on purpose. Only an `unknown` code means something actually broke.
 * Duck-typed rather than `instanceof ActionError` so this stays correct across
 * separately-bundled module graphs (instrumentation.ts is its own).
 */
const EXPECTED_ACTION_CODES = ['not_found', 'forbidden', 'invalid_operation', 'insufficient_balance'];

function isExpectedThrow(error: unknown, normalized: Normalized): boolean {
  if (normalized.digest && CONTROL_FLOW_DIGESTS.some((d) => normalized.digest!.startsWith(d))) return true;
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && EXPECTED_ACTION_CODES.includes(code);
}

/** Groups by what makes two throws "the same bug" — everything else (ids, timestamps) varies per hit. */
function fingerprint(normalized: Normalized, report: ErrorReport): string {
  const frame = normalized.stack?.split('\n')[1]?.trim() ?? '';
  return `${report.source}|${report.route ?? ''}|${normalized.name}|${normalized.message}|${frame}`;
}

function allow(key: string): boolean {
  const now = Date.now();
  if (now - windowStartedAt > WINDOW_MS) {
    seen.clear();
    windowStartedAt = now;
    windowTotal = 0;
  }
  if (windowTotal >= TOTAL_LIMIT) return false;

  const entry = seen.get(key);
  if (!entry) {
    seen.set(key, { count: 1, firstAt: now });
    windowTotal++;
    return true;
  }
  entry.count++;
  if (entry.count > PER_FINGERPRINT_LIMIT) return false;
  windowTotal++;
  return true;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Plain-English triage, attached to every card.
 *
 * A raw stack trace answers "what threw" but not the two things you actually need at the
 * moment the phone buzzes: is this bad, and what do I do now. The patterns below cover the
 * failure shapes this stack actually produces (a Postgres function, a Supabase client, a
 * React tree), each with a first move that doesn't require reading the stack to act on.
 * The fallback is deliberately still useful rather than a shrug.
 *
 * When adding a case: match on something specific enough not to swallow unrelated errors,
 * and keep the fix to one concrete first action.
 */
const TRIAGE: { match: (text: string, name: string) => boolean; meaning: string; fix: string }[] = [
  {
    // The project's documented recurring trap - worth catching before the generic DB case.
    match: (t) => t.includes('could not choose the best candidate function') || t.includes('is not unique'),
    meaning:
      'Two copies of the same database function exist and Postgres cannot tell which one to call. This happens when a function gained or lost a parameter and the old version was never dropped.',
    fix: 'A known trap in this project (ARCHITECTURE.md has a section on it, including the query that finds leftovers). Paste this card into Claude Code and ask it to find and drop the stale overload in a new migration.',
  },
  {
    match: (t) =>
      t.includes('does not exist') ||
      t.includes('schema cache') ||
      t.includes('undefined column') ||
      t.includes('undefined table'),
    meaning:
      'The app asked the database for a table, column, or function that is not there. Almost always means the code went live but the migration that goes with it did not.',
    fix: 'Run `npx supabase db push` from the repo. Migrations do not ship with a Vercel deploy, they are a separate step. If it reports nothing pending, paste this card into Claude Code.',
  },
  {
    match: (t, name) =>
      name === 'TypeError' && (t.includes('reading') || t.includes('of null') || t.includes('of undefined')),
    meaning:
      'Something the page expected to find came back empty, and the code used it anyway. Usually a market, group, or bet that was deleted or hidden, or a field that is allowed to be blank and was not checked for.',
    fix: 'The first line of the stack below is the exact file and line. Paste this card into Claude Code and ask it to handle the empty case there.',
  },
  {
    match: (t) => t.includes('is not a function') || t.includes('is not defined') || t.includes('cannot find module'),
    meaning:
      'The code called something that does not exist under that name. Usually a rename, a moved file, or a deleted export that one call site still points at.',
    fix: 'Paste this card into Claude Code. This one is normally a one-line fix, and `npx tsc --noEmit` will usually confirm it before you redeploy.',
  },
  {
    match: (t) => t.includes('hydration') || t.includes('did not match'),
    meaning:
      'The version of the page built on the server did not match what the browser drew on top of it. Usually caused by something that differs between the two, like a date, a random value, or something read from the browser too early.',
    fix: 'Cosmetic. Nothing is lost or miscounted, the page just re-renders. Paste this card into Claude Code along with the file named in the stack.',
  },
  {
    match: (t) => t.includes('fetch failed') || t.includes('econnrefused') || t.includes('enotfound') || t.includes('socket'),
    meaning: 'A call out to another service (Supabase, a push service, Slack) did not get through.',
    fix: 'Often a blip that fixes itself. If it appears once, ignore it. If it keeps arriving, check status.supabase.com and the Vercel status page before changing any code.',
  },
  {
    match: (t) => t.includes('timeout') || t.includes('canceling statement'),
    meaning: 'A database query took long enough that Postgres gave up on it.',
    fix: 'If it is on a page that keeps growing (a leaderboard, a long market list), it usually means a query needs an index. Paste this card into Claude Code and ask it to look at the query behind this route.',
  },
  {
    match: (t) => t.includes('jwt') || t.includes('invalid token') || t.includes('session') || t.includes('unauthorized'),
    meaning: 'Something went wrong working out who the logged-in user is.',
    fix: 'If this is one person once, their session expired and signing in again clears it. If it is arriving for everyone, check the Supabase keys in the Vercel environment variables first.',
  },
];

const FALLBACK_TRIAGE = {
  meaning: 'Something threw that the app did not expect and had no specific handling for.',
  fix: 'Paste this whole card into Claude Code and say "this errored in production, work out why and fix it." The route and stack below are the whole starting point it needs.',
};

function triage(normalized: Normalized): { meaning: string; fix: string } {
  const text = `${normalized.name}: ${normalized.message}`.toLowerCase();
  return TRIAGE.find((t) => t.match(text, normalized.name)) ?? FALLBACK_TRIAGE;
}

/**
 * Fires and forgets a Slack card. Callers do not await it for anything they
 * care about: the request that produced the error has already failed, and
 * making its failure slower or noisier helps nobody.
 */
export async function reportError(report: ErrorReport): Promise<void> {
  const normalized = normalize(report.error);

  // Log first, unconditionally and in every environment. The console is the
  // record that always exists; Slack is the one that pages you.
  console.error(`[${report.source}]`, report.route ?? report.path ?? '', normalized.name, normalized.message, normalized.stack ?? '');

  if (!WEBHOOK_URL || !IS_PRODUCTION) return;
  if (isExpectedThrow(report.error, normalized)) return;
  if (!allow(fingerprint(normalized, report))) return;

  const fields: string[] = [
    `*Where:*\n${report.source === 'client' ? 'Browser' : 'Server'}`,
    `*Route:*\n\`${truncate(report.route || report.path || 'unknown', 120)}\``,
  ];
  if (report.method) fields.push(`*Method:*\n${report.method}`);
  if (report.path && report.path !== report.route) fields.push(`*Path:*\n\`${truncate(report.path, 120)}\``);
  if (normalized.digest) fields.push(`*Digest:*\n\`${normalized.digest}\``);
  for (const [label, value] of Object.entries(report.context ?? {})) {
    if (value) fields.push(`*${label}:*\n${truncate(value, 200)}`);
  }

  const { meaning, fix } = triage(normalized);

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `🚨 ${truncate(normalized.name, 80)}`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${truncate(normalized.message, 800)}*` } },
    // Slack caps a section at 10 fields.
    { type: 'section', fields: fields.slice(0, 10).map((text) => ({ type: 'mrkdwn', text })) },
    { type: 'section', text: { type: 'mrkdwn', text: `*What's happening*\n${meaning}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*What to do*\n${fix}` } },
  ];
  if (normalized.stack) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${truncate(normalized.stack, 2600)}\`\`\`` } });
  }
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        // Worth restating on every card: every balance change in this app is a single
        // transactional Postgres function call, so a crash in the app layer cannot leave a
        // payout or a bet half-applied. That is the first thing anyone wants to know.
        text: 'Tokens and balances are safe: every money change is one all-or-nothing database call, so a crash cannot half-apply one. Repeats of the same error go quiet after 3 in 10 minutes, so a card arriving again means it is still happening.',
      },
    ],
  });

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 ${normalized.name}: ${truncate(normalized.message, 200)}`,
        blocks,
      }),
    });
    // Slack answers a malformed Block Kit payload with 400 and a body naming the bad block,
    // not by failing the request. Without this check a formatting mistake here would mean
    // silence in the channel and no trace of why, which is the one failure mode error
    // reporting cannot afford.
    if (!response.ok) {
      console.error('Slack rejected the error report:', response.status, await response.text().catch(() => ''));
    }
  } catch (err) {
    console.error('reportError failed to reach Slack:', err);
  }
}
