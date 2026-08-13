/**
 * Builds the Slack Block Kit payload for a failed CI run and prints it to stdout,
 * for the workflow to POST to the #barbets-errors Incoming Webhook.
 *
 * Everything arrives via environment variables rather than argv so a backtick,
 * quote or newline in a commit message or PR title can never break the shell
 * command or the JSON. Kept as a file rather than inline YAML so it can be run
 * and eyeballed locally:
 *
 *   STATIC_RESULT=failure INTEGRATION_RESULT=success TRIGGER="push to main" \
 *     COMMIT_MESSAGE="whatever" node .github/scripts/slack-ci-failure.mjs
 */

const {
  STATIC_RESULT = '',
  INTEGRATION_RESULT = '',
  MIGRATIONS_RESULT = '',
  EVENT_NAME = '',
  PR_NUMBER = '',
  PR_TITLE = '',
  BRANCH = '',
  COMMIT_MESSAGE = '',
  GITHUB_ACTOR = 'unknown',
  GITHUB_SHA = '',
  RUN_URL = '',
} = process.env;

/**
 * Assembled here rather than with format() in the workflow's env block: a "#"
 * preceded by a space inside an unquoted YAML scalar begins a comment, which
 * silently truncated the expression and made the whole file invalid. Keeping
 * run-time strings out of the YAML also means a PR title can never reach the
 * shell.
 */
const TRIGGER =
  EVENT_NAME === 'pull_request'
    ? `PR #${PR_NUMBER}: ${PR_TITLE}`
    : `push to ${BRANCH || 'unknown branch'}`;

/** head_commit is absent on a pull_request event, where the PR title is the useful subject. */
const subject = COMMIT_MESSAGE || PR_TITLE;

/** A job can also be 'cancelled' or 'skipped'; only an outright failure is worth naming. */
const failed = [
  STATIC_RESULT === 'failure' && 'Typecheck and build',
  INTEGRATION_RESULT === 'failure' && 'Migrate staging and run integration tests',
  MIGRATIONS_RESULT === 'failure' && 'Migration reminder',
].filter(Boolean);

// failure() fired, so something went wrong even if neither named job is the culprit
// (a cancelled-then-failed step, a runner dying). Say so rather than printing "".
const failedLabel = failed.length > 0 ? failed.join(', ') : 'the run did not complete';

/** Slack section text caps at 3000 chars; commit bodies can be far longer. */
const truncate = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const firstLine = truncate((subject.split('\n')[0] || '(no message)').trim(), 300);

const fields = [
  ['Failed', failedLabel],
  ['Trigger', TRIGGER],
  ['Commit', GITHUB_SHA ? `\`${GITHUB_SHA.slice(0, 7)}\`` : '(unknown)'],
  ['By', GITHUB_ACTOR],
].map(([label, value]) => ({ type: 'mrkdwn', text: `*${label}*\n${value}` }));

const blocks = [
  { type: 'header', text: { type: 'plain_text', text: 'CI failed' } },
  { type: 'section', fields },
  { type: 'section', text: { type: 'mrkdwn', text: `*Message*\n${firstLine}` } },
];

if (RUN_URL) {
  blocks.push({
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: 'View the logs' }, url: RUN_URL }],
  });
}

// `text` is the notification/fallback line: what shows in the sidebar and on a phone.
process.stdout.write(JSON.stringify({ text: `CI failed: ${failedLabel}`, blocks }));
