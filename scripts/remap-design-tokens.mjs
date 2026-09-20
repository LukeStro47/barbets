#!/usr/bin/env node
/**
 * One-shot remap of warm café Tailwind classes → ledger tokens from DESIGN.md.
 * Run from repo root. Idempotent enough for a single migration pass.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const EXT = new Set(['.tsx', '.ts', '.css', '.mjs', '.jsx']);

/** Longer / more specific keys first so partials don't eat them. */
const REPLACEMENTS = [
  // Paper
  ['bg-paper-white', 'bg-surface'],
  ['bg-paper-dim', 'bg-rule'],
  ['bg-paper', 'bg-canvas'],
  ['text-paper-white', 'text-white'],
  ['text-paper', 'text-canvas'],
  ['border-paper-white', 'border-surface'],
  ['border-paper-dim', 'border-rule'],
  ['border-paper', 'border-canvas'],
  ['from-paper-white', 'from-surface'],
  ['from-paper-dim', 'from-rule'],
  ['from-paper', 'from-canvas'],
  ['to-paper-white', 'to-surface'],
  ['to-paper-dim', 'to-rule'],
  ['to-paper', 'to-canvas'],
  ['via-paper-white', 'via-surface'],
  ['via-paper-dim', 'via-rule'],
  ['via-paper', 'via-canvas'],
  ['ring-paper-white', 'ring-surface'],
  ['fill-paper-white', 'fill-white'],
  ['stroke-paper-white', 'stroke-white'],

  // Espresso ramp → ink / muted / faint / hairline / rule
  ['text-espresso-950', 'text-ink'],
  ['text-espresso-900', 'text-ink'],
  ['text-espresso-800', 'text-ink'],
  ['text-espresso-700', 'text-muted'],
  ['text-espresso-600', 'text-muted'],
  ['text-espresso-500', 'text-muted'],
  ['text-espresso-400', 'text-faint'],
  ['text-espresso-300', 'text-faint'],
  ['text-espresso-200', 'text-dash'],
  ['text-espresso-100', 'text-rule'],
  ['text-espresso-50', 'text-rule'],
  ['bg-espresso-950', 'bg-ink'],
  ['bg-espresso-900', 'bg-ink'],
  ['bg-espresso-800', 'bg-ink'],
  ['bg-espresso-700', 'bg-muted'],
  ['bg-espresso-600', 'bg-muted'],
  ['bg-espresso-500', 'bg-muted'],
  ['bg-espresso-400', 'bg-faint'],
  ['bg-espresso-300', 'bg-faint'],
  ['bg-espresso-200', 'bg-dash'],
  ['bg-espresso-100', 'bg-rule'],
  ['bg-espresso-50', 'bg-rule'],
  ['border-espresso-950', 'border-ink'],
  ['border-espresso-900', 'border-ink'],
  ['border-espresso-800', 'border-ink'],
  ['border-espresso-700', 'border-muted'],
  ['border-espresso-600', 'border-muted'],
  ['border-espresso-500', 'border-muted'],
  ['border-espresso-400', 'border-faint'],
  ['border-espresso-300', 'border-dash'],
  ['border-espresso-200', 'border-hairline'],
  ['border-espresso-100', 'border-hairline'],
  ['border-espresso-50', 'border-rule'],
  ['ring-espresso-950', 'ring-ink'],
  ['ring-espresso-900', 'ring-ink'],
  ['ring-espresso-800', 'ring-ink'],
  ['ring-espresso-200', 'ring-hairline'],
  ['ring-espresso-100', 'ring-hairline'],
  ['from-espresso-950', 'from-ink'],
  ['from-espresso-900', 'from-ink'],
  ['from-espresso-800', 'from-ink'],
  ['from-espresso-100', 'from-rule'],
  ['from-espresso-50', 'from-rule'],
  ['to-espresso-950', 'to-ink'],
  ['to-espresso-900', 'to-ink'],
  ['to-espresso-800', 'to-ink'],
  ['to-espresso-100', 'to-rule'],
  ['to-espresso-50', 'to-rule'],
  ['via-espresso-900', 'via-ink'],
  ['via-espresso-800', 'via-ink'],
  ['divide-espresso-100', 'divide-hairline'],
  ['divide-espresso-200', 'divide-hairline'],
  ['shadow-espresso-900/5', 'shadow-none'],
  ['shadow-espresso-900/10', 'shadow-none'],
  ['shadow-espresso-900/', 'shadow-ink/'],
  ['shadow-espresso-950/', 'shadow-ink/'],
  ['placeholder:text-espresso-500', 'placeholder:text-faint'],
  ['placeholder:text-espresso-400', 'placeholder:text-faint'],
  ['placeholder:text-espresso-300', 'placeholder:text-faint'],
  ['caret-espresso-800', 'caret-ink'],
  ['caret-espresso-900', 'caret-ink'],
  ['outline-espresso-200', 'outline-hairline'],
  ['fill-espresso-800', 'fill-ink'],
  ['fill-espresso-900', 'fill-ink'],
  ['stroke-espresso-300', 'stroke-faint'],
  ['stroke-espresso-400', 'stroke-faint'],
  ['stroke-espresso-800', 'stroke-ink'],

  // Honey → signal
  ['text-honey-900', 'text-signal-deep'],
  ['text-honey-800', 'text-signal-deep'],
  ['text-honey-700', 'text-signal'],
  ['text-honey-600', 'text-signal'],
  ['text-honey-500', 'text-signal'],
  ['text-honey-400', 'text-signal'],
  ['text-honey-300', 'text-on-ink'],
  ['text-honey-200', 'text-on-ink'],
  ['text-honey-100', 'text-signal-tint'],
  ['text-honey-50', 'text-signal-tint'],
  ['bg-honey-900', 'bg-signal-deep'],
  ['bg-honey-800', 'bg-signal-deep'],
  ['bg-honey-700', 'bg-signal'],
  ['bg-honey-600', 'bg-signal'],
  ['bg-honey-500', 'bg-signal'],
  ['bg-honey-400', 'bg-signal'],
  ['bg-honey-300', 'bg-signal-tint'],
  ['bg-honey-200', 'bg-signal-tint'],
  ['bg-honey-100', 'bg-signal-tint'],
  ['bg-honey-50', 'bg-signal-tint'],
  ['border-honey-900', 'border-signal-deep'],
  ['border-honey-800', 'border-signal-deep'],
  ['border-honey-700', 'border-signal'],
  ['border-honey-600', 'border-signal'],
  ['border-honey-500', 'border-signal'],
  ['border-honey-400', 'border-signal'],
  ['border-honey-300', 'border-signal'],
  ['border-honey-200', 'border-signal-tint'],
  ['border-honey-100', 'border-signal-tint'],
  ['ring-honey-500', 'ring-signal'],
  ['ring-honey-400', 'ring-signal'],
  ['ring-honey-300', 'ring-signal'],
  ['from-honey-500', 'from-signal'],
  ['from-honey-400', 'from-signal'],
  ['from-honey-100', 'from-signal-tint'],
  ['from-honey-50', 'from-signal-tint'],
  ['to-honey-500', 'to-signal'],
  ['to-honey-400', 'to-signal'],
  ['to-honey-100', 'to-signal-tint'],
  ['to-honey-50', 'to-signal-tint'],
  ['via-honey-500', 'via-signal'],
  ['via-honey-300', 'via-signal-tint'],
  ['fill-honey-500', 'fill-signal'],
  ['fill-honey-400', 'fill-signal'],
  ['stroke-honey-500', 'stroke-signal'],
  ['stroke-honey-600', 'stroke-signal'],
  ['shadow-honey-500/', 'shadow-signal/'],
  ['shadow-honey-400/', 'shadow-signal/'],

  // Success / danger → gain / alert
  ['text-success-700', 'text-gain'],
  ['text-success-500', 'text-gain'],
  ['text-success-100', 'text-gain-bg'],
  ['bg-success-700', 'bg-gain'],
  ['bg-success-500', 'bg-gain'],
  ['bg-success-100', 'bg-gain-bg'],
  ['border-success-700', 'border-gain'],
  ['border-success-500', 'border-gain'],
  ['border-success-100', 'border-gain-line'],
  ['text-danger-700', 'text-alert'],
  ['text-danger-500', 'text-alert'],
  ['text-danger-100', 'text-alert-bg'],
  ['bg-danger-700', 'bg-alert'],
  ['bg-danger-500', 'bg-alert'],
  ['bg-danger-100', 'bg-alert-bg'],
  ['border-danger-700', 'border-alert'],
  ['border-danger-500', 'border-alert'],
  ['border-danger-100', 'border-alert-line'],

  // CSS var leftovers inside comments/strings in tsx are rare; handle common ones
  ['var(--color-paper-white)', 'var(--color-surface)'],
  ['var(--color-paper-dim)', 'var(--color-rule)'],
  ['var(--color-paper)', 'var(--color-canvas)'],
  ['var(--color-espresso-950)', 'var(--color-ink)'],
  ['var(--color-espresso-900)', 'var(--color-ink)'],
  ['var(--color-espresso-800)', 'var(--color-ink)'],
  ['var(--color-espresso-100)', 'var(--color-rule)'],
  ['var(--color-espresso-50)', 'var(--color-rule)'],
  ['var(--color-honey-600)', 'var(--color-signal)'],
  ['var(--color-honey-500)', 'var(--color-signal)'],
  ['var(--color-danger-500)', 'var(--color-alert)'],
  ['var(--color-success-500)', 'var(--color-gain)'],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

let filesChanged = 0;
let totalSubs = 0;
for (const root of ROOTS) {
  const abs = path.join(process.cwd(), root);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    let src = fs.readFileSync(file, 'utf8');
    let next = src;
    for (const [from, to] of REPLACEMENTS) {
      if (next.includes(from)) {
        const count = next.split(from).length - 1;
        next = next.split(from).join(to);
        totalSubs += count;
      }
    }
    // Badge tone rename honey → signal (prop values)
    next = next.replace(/tone=["']honey["']/g, 'tone="signal"');
    next = next.replace(/tone:\s*['"]honey['"]/g, "tone: 'signal'");
    if (next !== src) {
      fs.writeFileSync(file, next);
      filesChanged++;
    }
  }
}

console.log(`Updated ${filesChanged} files (${totalSubs} substitutions)`);
