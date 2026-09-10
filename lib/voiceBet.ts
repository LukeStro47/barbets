/**
 * The voice-to-bet parser: a spoken transcript in, a pre-filled create-market form out.
 *
 * Rules, not a model, on purpose. The whole feature is "say the bet instead of typing it", and the
 * five shapes a bet can take are already fixed by the type list in lib/marketType.ts, so the job
 * is spotting which of five phrasings someone used ("over under", "most likely to", "when will",
 * "will ...", anything else) and pulling one number out of it. A handful of regexes does that
 * deterministically, runs in microseconds on the phone, is unit-testable on fixed strings, and
 * sends nothing anywhere. A model would add latency, a network hop for the transcript, and a
 * failure mode ("it guessed something plausible but wrong") that a rule table doesn't have. The
 * user confirms every field before anything is submitted, so a wrong guess costs one tap.
 *
 * Pure: no React, no Capacitor, no Supabase. The speech plugin lives in
 * components/markets/VoiceBetButton.tsx; this file only ever sees a string. Imports are relative
 * rather than `@/lib/...` because vitest (which has no path alias configured) loads it directly.
 */

import type { MarketType } from './marketType';
import { MARKET_TITLE_MAX_LENGTH } from './limits';

export interface SpokenBet {
  marketType: MarketType;
  /** Tidied for the title field: fillers dropped, first letter capitalised, a trailing "?" on a
   * question, cut to the title cap. Never empty for a non-empty transcript. */
  title: string;
  /** over_under only. Already in the form `markets.line` stores (see lib/units.ts): a plain number,
   * minutes since midnight when `unit` is 'time', UTC-midnight epoch seconds when 'date'. */
  line?: number;
  /** over_under only. One of the wizard's unit presets ('$', 'mins', 'hrs', 'pts', '%', '€'), or the
   * 'date' / 'time' line-format marker the form already stores in `markets.unit`. */
  unit?: string;
  /** most_likely_to only: the roster nicknames spoken, in roster order and roster casing. */
  prePickedNicknames?: string[];
}

export interface ParseOptions {
  /** "Today" for resolving a spoken date to its next occurrence. Tests pin it; the form leaves it. */
  now?: Date;
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

interface Token {
  /** Lowercased, outer punctuation stripped (a leading currency sign and a trailing "%" survive on purpose). */
  norm: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const norm = m[0]
      .toLowerCase()
      .replace(/^[^a-z0-9$€£.]+/, '')
      .replace(/[^a-z0-9%]+$/, '');
    if (norm) out.push({ norm, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Numbers: digits, and the words people actually say for them
// ---------------------------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MERIDIEM: Record<string, 'am' | 'pm'> = { am: 'am', 'a.m': 'am', pm: 'pm', 'p.m': 'pm' };

const DIGIT_RE = /^([$€£])?(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(am|pm|%|st|nd|rd|th)?$/;

interface NumberRead {
  value: number;
  /** Index of the first token after the number phrase. */
  next: number;
  /** A currency symbol spoken as a prefix ("$50"). */
  prefix?: string;
  /** "10pm", "75%": the suffix glued onto a digit token. */
  suffix?: string;
  /** True when it came from words rather than digits, i.e. the title wants it rewritten. */
  wordy: boolean;
}

/** "point five", "and a half", "and three quarters": the fractional tail after a whole number. */
function readFraction(tokens: Token[], i: number): { value: number; next: number } | null {
  const w = tokens[i]?.norm;
  if (w === 'point') {
    let digits = '';
    let j = i + 1;
    while (j < tokens.length) {
      const d = tokens[j].norm;
      if (d in UNITS && UNITS[d] < 10) digits += String(UNITS[d]);
      else if (/^\d+$/.test(d)) digits += d;
      else break;
      j += 1;
    }
    return digits ? { value: Number(`0.${digits}`), next: j } : null;
  }
  if (w === 'and') {
    const a = tokens[i + 1]?.norm;
    const b = tokens[i + 2]?.norm;
    if ((a === 'a' || a === 'one') && b === 'half') return { value: 0.5, next: i + 3 };
    if ((a === 'a' || a === 'one') && b === 'quarter') return { value: 0.25, next: i + 3 };
    if (a === 'three' && b === 'quarters') return { value: 0.75, next: i + 3 };
    if (a === 'half') return { value: 0.5, next: i + 2 };
  }
  return null;
}

function readNumber(tokens: Token[], i: number): NumberRead | null {
  const t = tokens[i];
  if (!t) return null;

  const digit = t.norm.match(DIGIT_RE);
  if (digit) {
    let value = Number(digit[2].replace(/,/g, ''));
    let next = i + 1;
    if (!digit[3]) {
      const frac = readFraction(tokens, next);
      if (frac) {
        value += frac.value;
        next = frac.next;
      }
    }
    return { value, next, prefix: digit[1], suffix: digit[3], wordy: false };
  }

  // Words. `current` is the sub-thousand group being built, `total` the thousands already banked.
  // `last` is what was just consumed, which decides whether the next word can follow it ("twenty
  // five" yes, "five twenty" no, "hundred and twenty" yes, "and a half" belongs to the fraction).
  let total = 0;
  let current = 0;
  let last: 'none' | 'a' | 'unit' | 'tens' | 'hundred' | 'thousand' | 'and' = 'none';
  let j = i;
  while (j < tokens.length) {
    const w = tokens[j].norm;
    const peek = tokens[j + 1]?.norm;
    const openForDigit = last === 'none' || last === 'hundred' || last === 'thousand' || last === 'and';
    if ((w === 'a' || w === 'an') && last === 'none' && (peek === 'hundred' || peek === 'thousand')) {
      current = 1;
      last = 'a';
    } else if (w in UNITS && (openForDigit || (last === 'tens' && UNITS[w] < 10))) {
      current += UNITS[w];
      last = 'unit';
    } else if (w in TENS && openForDigit) {
      current += TENS[w];
      last = 'tens';
    } else if (w === 'hundred' && (last === 'none' || last === 'a' || last === 'unit') && current < 100) {
      current = (current || 1) * 100;
      last = 'hundred';
    } else if (w === 'thousand' && last !== 'thousand' && last !== 'and' && total === 0) {
      total = (current || 1) * 1000;
      current = 0;
      last = 'thousand';
    } else if (w === 'and' && (last === 'hundred' || last === 'thousand') && peek !== undefined && (peek in UNITS || peek in TENS)) {
      last = 'and';
    } else {
      break;
    }
    j += 1;
  }
  const consumed = j > i && last !== 'a';
  let value = total + current;
  const frac = readFraction(tokens, j);
  if (frac) {
    value += frac.value;
    j = frac.next;
  } else if (!consumed) {
    return null;
  }
  return { value, next: j, wordy: true };
}

// ---------------------------------------------------------------------------------------------
// A time of day or a calendar date as the line (lib/units.ts's 'time' / 'date' line formats)
// ---------------------------------------------------------------------------------------------

interface LineRead {
  line: number;
  unit?: string;
  /** Token span the phrase occupied, so the title can drop or rewrite it. */
  from: number;
  to: number;
  wordy: boolean;
}

function meridiemOf(token: Token | undefined): 'am' | 'pm' | undefined {
  return token && token.norm in MERIDIEM ? MERIDIEM[token.norm] : undefined;
}

function readTime(tokens: Token[], i: number): LineRead | null {
  const t = tokens[i];
  if (!t) return null;
  if (t.norm === 'noon' || t.norm === 'midday') return { line: 12 * 60, unit: 'time', from: i, to: i + 1, wordy: false };
  if (t.norm === 'midnight') return { line: 0, unit: 'time', from: i, to: i + 1, wordy: false };

  const colon = t.norm.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (colon) {
    let hours = Number(colon[1]);
    const minutes = Number(colon[2]);
    let next = i + 1;
    let meridiem = colon[3] as 'am' | 'pm' | undefined;
    if (!meridiem) {
      meridiem = meridiemOf(tokens[next]);
      if (meridiem) next += 1;
    }
    if (hours > 23 || minutes > 59) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return { line: hours * 60 + minutes, unit: 'time', from: i, to: next, wordy: false };
  }

  const n = readNumber(tokens, i);
  if (!n || n.prefix || !Number.isInteger(n.value) || n.value < 0 || n.value > 24) return null;
  let hours = n.value;
  let minutes = 0;
  let next = n.next;
  let meridiem: 'am' | 'pm' | undefined = n.suffix && n.suffix in MERIDIEM ? MERIDIEM[n.suffix] : undefined;
  if (!meridiem) {
    const m = readNumber(tokens, next);
    if (m && !m.prefix && Number.isInteger(m.value) && m.value >= 0 && m.value < 60) {
      // "ten thirty pm": the minutes only count with an am/pm after them, else "ten thirty" is
      // just two numbers in a row and the caller's number reader gets its turn.
      const afterMinutes = m.suffix && m.suffix in MERIDIEM ? MERIDIEM[m.suffix] : meridiemOf(tokens[m.next]);
      if (!afterMinutes) return null;
      minutes = m.value;
      meridiem = afterMinutes;
      next = m.suffix ? m.next : m.next + 1;
    } else if (meridiemOf(tokens[next])) {
      meridiem = meridiemOf(tokens[next]);
      next += 1;
    } else if (tokens[next] && /^o'?clock$/.test(tokens[next].norm)) {
      next += 1;
    } else {
      return null;
    }
  }
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours === 24) hours = 0;
  return { line: hours * 60 + minutes, unit: 'time', from: i, to: next, wordy: n.wordy };
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
  july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9,
  november: 10, nov: 10, december: 11, dec: 11,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

/** "5", "5th", "fifth", "twenty first". */
function readDayOfMonth(tokens: Token[], i: number): { day: number; next: number } | null {
  const w = tokens[i]?.norm;
  if (!w) return null;
  const digit = w.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (digit) {
    const day = Number(digit[1]);
    return day >= 1 && day <= 31 ? { day, next: i + 1 } : null;
  }
  if (w in ORDINALS) return { day: ORDINALS[w], next: i + 1 };
  const nextWord = tokens[i + 1]?.norm;
  if ((w === 'twenty' || w === 'thirty') && nextWord && nextWord in ORDINALS && ORDINALS[nextWord] < 10) {
    const day = TENS[w] + ORDINALS[nextWord];
    return day <= 31 ? { day, next: i + 2 } : null;
  }
  return null;
}

function readDate(tokens: Token[], i: number, now: Date): LineRead | null {
  const w = tokens[i]?.norm;
  if (!w) return null;
  let month: number;
  let day: number;
  let next: number;

  if (w in MONTHS) {
    // "March 5th", "March the 5th"
    month = MONTHS[w];
    next = i + 1;
    if (tokens[next]?.norm === 'the') next += 1;
    const d = readDayOfMonth(tokens, next);
    if (!d) return null;
    day = d.day;
    next = d.next;
  } else {
    // "5th of March", "the fifth of March"
    const d = readDayOfMonth(tokens, i);
    if (!d) return null;
    next = d.next;
    if (tokens[next]?.norm === 'of') next += 1;
    const mw = tokens[next]?.norm;
    if (!mw || !(mw in MONTHS)) return null;
    month = MONTHS[mw];
    day = d.day;
    next += 1;
  }

  let year: number | undefined;
  if (tokens[next] && /^\d{4}$/.test(tokens[next].norm)) {
    year = Number(tokens[next].norm);
    next += 1;
  }
  // No year spoken: the next time that date comes round, today included.
  if (year === undefined) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    year = now.getUTCFullYear();
    if (Date.UTC(year, month, day) < today) year += 1;
  }
  return { line: Date.UTC(year, month, day) / 1000, unit: 'date', from: i, to: next, wordy: true };
}

// ---------------------------------------------------------------------------------------------
// Units: the wizard's presets, as spoken
// ---------------------------------------------------------------------------------------------

const UNIT_WORDS: Record<string, string> = {
  dollar: '$', dollars: '$', buck: '$', bucks: '$',
  euro: '€', euros: '€',
  minute: 'mins', minutes: 'mins', min: 'mins', mins: 'mins',
  hour: 'hrs', hours: 'hrs', hr: 'hrs', hrs: 'hrs',
  point: 'pts', points: 'pts', pt: 'pts', pts: 'pts',
  percent: '%', percentage: '%',
};
const CURRENCY_PREFIX: Record<string, string> = { $: '$', '€': '€', '£': '£' };

/** The first line phrase at or after token `from`: a time, a date, or a number with an optional
 * unit, whichever starts first. Positional so "5 drinks by 10 pm" reads as the 5, not the 10. */
function findLine(tokens: Token[], from: number, now: Date): LineRead | null {
  for (let i = from; i < tokens.length; i += 1) {
    const time = readTime(tokens, i);
    if (time) return time;
    const date = readDate(tokens, i, now);
    if (date) return date;
    const n = readNumber(tokens, i);
    if (!n) continue;
    let unit: string | undefined;
    let to = n.next;
    if (n.prefix && n.prefix in CURRENCY_PREFIX) unit = CURRENCY_PREFIX[n.prefix];
    else if (n.suffix === '%') unit = '%';
    else if (tokens[to] && tokens[to].norm in UNIT_WORDS) {
      unit = UNIT_WORDS[tokens[to].norm];
      to += 1;
    }
    return { line: n.value, unit, from: i, to, wordy: n.wordy };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------------------------

/** Throat-clearing a recognizer faithfully transcribes and a title has no use for. */
const LEADING_FILLER_RE = /^(?:(?:ok(?:ay)?|so|um+|uh+|alright|new (?:bet|market)|i bet(?: that)?|bet(?: that)?|market)[,.:]?\s+)+/i;
const QUESTION_START_RE = /^(?:will|who|who's|whos|when|when's|what|what's|where|which|how|is|are|does|do|did|can|could|has|have|would|should)\b/i;

function tidyTitle(raw: string, options: { question?: boolean } = {}): string {
  let s = raw
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.?!:;])/g, '$1')
    .trim()
    .replace(/^[\s,.:;!?-]+/, '')
    .replace(/[\s,:;-]+$/, '')
    .trim();
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  const wantsQuestionMark = options.question ?? QUESTION_START_RE.test(s);
  if (wantsQuestionMark && !/[?!.]$/.test(s)) s += '?';
  if (s.length > MARKET_TITLE_MAX_LENGTH) {
    const cut = s.slice(0, MARKET_TITLE_MAX_LENGTH);
    const atWord = cut.lastIndexOf(' ');
    s = (atWord > MARKET_TITLE_MAX_LENGTH * 0.6 ? cut.slice(0, atWord) : cut).replace(/[\s,:;-]+$/, '');
  }
  return s;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Roster nicknames that appear as whole words, case-insensitively, in roster order. */
function matchNicknames(text: string, roster: string[]): string[] {
  const hay = text.toLowerCase();
  return roster.filter((nick) => {
    const n = nick.trim().toLowerCase();
    if (!n) return false;
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(n)}(?=$|[^a-z0-9])`).test(hay);
  });
}

/** "..., Jake or Sam" / ": Jake, Sam and Priya" / "between Jake and Sam" hanging off the end of a
 * most_likely_to phrase are the options, not the question. Only names that matched the roster
 * count, so a stranger's name stays in the title where it can still be read. */
function stripTrailingNames(phrase: string, names: string[]): string {
  if (names.length === 0) return phrase;
  const nick = `(?:${names.map(escapeRegExp).join('|')})`;
  const re = new RegExp(`(?:[,:;]|\\bbetween|\\bout of)?\\s*${nick}(?:\\s*(?:,\\s*(?:and|or)|,|and|or|&)\\s*${nick})*\\s*[?.!]?\\s*$`, 'i');
  const stripped = phrase.replace(re, '').trim();
  return stripped || phrase;
}

// ---------------------------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------------------------

const OVER_UNDER_RE = /\bover\s*(?:[/-]|or|slash)?\s*under\b/i;
const MOST_LIKELY_RE = /\b(?:who(?:'s|s| is| has| was)?\s+)?(?:the\s+)?most\s+likely\s+to\b\s*/i;
const WHEN_START_RE = /^when\b/i;
const WHEN_ANYWHERE_RE = /\bwhen(?:'s| will| does| do| did| is)\b/i;

/**
 * The rule table, top to bottom, first match wins:
 *
 *   "over under" + a line phrase   -> over_under  (line, unit; a spoken time/date becomes the form's
 *                                                   'time' / 'date' line format)
 *   "[who's] most likely to ..."   -> most_likely_to (title "Who's most likely to ...?", roster
 *                                                   nicknames spoken are pre-picked)
 *   "when [will] ..."              -> when
 *   "over under" with no number    -> over_under with an empty line for the user to fill
 *   "will ..." / anything else     -> yes_no with the transcript as the title
 */
export function parseSpokenBet(transcript: string, rosterNicknames: string[], options: ParseOptions = {}): SpokenBet {
  const now = options.now ?? new Date();
  const text = transcript.replace(/\s+/g, ' ').trim().replace(LEADING_FILLER_RE, '');
  if (!text) return { marketType: 'yes_no', title: '' };

  const marker = text.match(OVER_UNDER_RE);
  const overUnder = marker ? readOverUnder(text, marker, now) : null;
  if (overUnder && overUnder.line !== undefined) return overUnder;

  const likely = text.match(MOST_LIKELY_RE);
  if (likely) {
    const rest = text.slice((likely.index ?? 0) + likely[0].length);
    const names = matchNicknames(text, rosterNicknames);
    const phrase = stripTrailingNames(rest, names);
    return {
      marketType: 'most_likely_to',
      title: tidyTitle(`Who's most likely to ${phrase}`, { question: true }),
      prePickedNicknames: names,
    };
  }

  if (WHEN_START_RE.test(text)) return { marketType: 'when', title: tidyTitle(text, { question: true }) };
  const whenAt = text.match(WHEN_ANYWHERE_RE);
  if (whenAt) return { marketType: 'when', title: tidyTitle(text.slice(whenAt.index ?? 0), { question: true }) };

  if (overUnder) return overUnder;

  return { marketType: 'yes_no', title: tidyTitle(text) };
}

function readOverUnder(text: string, marker: RegExpMatchArray, now: Date): SpokenBet {
  const markerStart = marker.index ?? 0;
  const markerEnd = markerStart + marker[0].length;
  // The title is the transcript minus the marker; the number is looked for right after where the
  // marker was first, then anywhere ("how many drinks tonight, over under five" puts it last).
  const without = `${text.slice(0, markerStart)} ${text.slice(markerEnd)}`;
  const tokens = tokenize(without);
  const firstAfter = tokens.findIndex((t) => t.start >= markerStart);
  let found = firstAfter >= 0 ? findLine(tokens, firstAfter, now) : null;
  const adjacent = !!found && found.from === firstAfter;
  if (!found) found = findLine(tokens, 0, now);

  let title: string;
  if (!found) {
    title = without;
  } else if (adjacent) {
    // "over under five and a half drinks ...": the line is the form's, the title keeps what's left.
    const a = tokens[found.from].start;
    const b = tokens[found.to - 1].end;
    title = `${without.slice(0, a)} ${without.slice(b)}`;
    if (!tidyTitle(title)) title = without;
  } else if (found.wordy && found.unit !== 'date' && found.unit !== 'time') {
    // A number spoken elsewhere in the sentence stays in the title, but as digits.
    const a = tokens[found.from].start;
    const b = tokens[found.to - 1].end;
    const unitWord = found.unit && tokens[found.to - 1].norm in UNIT_WORDS ? ` ${tokens[found.to - 1].norm}` : '';
    title = `${without.slice(0, a)}${found.line}${unitWord}${without.slice(b)}`;
  } else {
    title = without;
  }

  const bet: SpokenBet = { marketType: 'over_under', title: tidyTitle(title) };
  if (found) {
    bet.line = found.line;
    if (found.unit) bet.unit = found.unit;
  }
  return bet;
}
