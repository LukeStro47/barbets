/**
 * Renders the "you still have to push these yourself" reminder for a change that
 * touches supabase/migrations/, in one of two shapes:
 *
 *   MODE=comment  -> markdown for a pull request comment (stdout)
 *   MODE=slack    -> a Block Kit payload for #barbets-errors (stdout, JSON)
 *
 * Merging deploys app code via Vercel but never applies migrations, so the two
 * can arrive out of order. The PR comment is the primary nudge because it fires
 * while the correct action (push *before* merging, so the schema is waiting when
 * the code lands) is still available. The Slack message is only a backstop for
 * having merged anyway.
 *
 * Text comes in through environment variables, never argv, so a branch name or
 * commit subject cannot break the shell command or the JSON. Run it locally:
 *
 *   MODE=comment MIGRATION_FILES=$'supabase/migrations/20260813_a.sql' \
 *     node .github/scripts/migration-nudge.mjs
 */

const {
  MODE = 'comment',
  MIGRATION_FILES = '',
  RUN_URL = '',
  GITHUB_SHA = '',
  GITHUB_ACTOR = 'unknown',
} = process.env;

/** Marker kept as the first line of the comment so a re-run can find and update its own note. */
export const MARKER = '<!-- barbets-migration-nudge -->';

const files = MIGRATION_FILES.split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const plural = files.length === 1 ? 'migration' : 'migrations';
const list = files.map((f) => `- \`${f.replace(/^supabase\/migrations\//, '')}\``).join('\n');

if (MODE === 'comment') {
  process.stdout.write(
    `${MARKER}
### ${files.length} ${plural} in this pull request

${list}

Merging deploys the app but **not** the database. Run this before you merge, so the schema is already there when Vercel ships the code:

\`\`\`
npx supabase db push
\`\`\`

CI has already applied ${files.length === 1 ? 'it' : 'them'} to staging and run the suite against the result, so ${files.length === 1 ? 'it applies' : 'they apply'} cleanly.

> One exception: if any of these **drop or rename** something the live code still uses (including changing a function's parameters, which needs \`DROP FUNCTION\`), do not push ahead of the merge. That case wants a two-step deploy instead.
`,
  );
} else {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Migrations merged, not yet applied' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`main\` now has ${files.length} ${plural} that production does not. Run \`npx supabase db push\` unless you already did it before merging.`,
      },
    },
    { type: 'section', text: { type: 'mrkdwn', text: list || '(none listed)' } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `merged by ${GITHUB_ACTOR}${GITHUB_SHA ? ` · \`${GITHUB_SHA.slice(0, 7)}\`` : ''}`,
        },
      ],
    },
  ];

  if (RUN_URL) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'View the run' }, url: RUN_URL }],
    });
  }

  process.stdout.write(
    JSON.stringify({ text: `${files.length} ${plural} merged to main and not yet pushed to production`, blocks }),
  );
}
