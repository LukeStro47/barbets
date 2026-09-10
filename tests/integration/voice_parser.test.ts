/**
 * Pure unit cases for lib/voiceBet.ts, the rules that turn a spoken transcript into a pre-filled
 * create-market form. Lives under tests/integration/ only because that is the one glob
 * vitest.config.ts includes; it deliberately imports no Supabase helper (helpers/testUsers.ts reads
 * credentials at import time) so it runs with no env at all.
 */
import { describe, expect, it } from 'vitest';
import { parseSpokenBet } from '../../lib/voiceBet';

const roster = ['Jake', 'Sam', 'Priya', 'Big Mike'];
// A fixed "today" so a spoken date resolves the same way every run: Wed 9 Sep 2026.
const now = new Date(Date.UTC(2026, 8, 9, 15, 0, 0));

describe('parseSpokenBet: over / under', () => {
  it('reads a number-word line with a half and drops the marker and number from the title', () => {
    const bet = parseSpokenBet('over under five and a half drinks for Jake tonight', roster, { now });
    expect(bet.marketType).toBe('over_under');
    expect(bet.line).toBe(5.5);
    expect(bet.unit).toBeUndefined();
    expect(bet.title).toBe('Drinks for Jake tonight');
  });

  it('maps dollars to the $ preset', () => {
    const bet = parseSpokenBet('over under twenty five dollars on the bar tab', roster, { now });
    expect(bet).toMatchObject({ marketType: 'over_under', line: 25, unit: '$', title: 'On the bar tab' });
  });

  it('finds the line at the end of the sentence and keeps the question as the title', () => {
    const bet = parseSpokenBet('How many minutes will Sam be late over under fifteen minutes', roster, { now });
    expect(bet).toMatchObject({ marketType: 'over_under', line: 15, unit: 'mins', title: 'How many minutes will Sam be late?' });
  });

  it('accepts digit strings, decimals and points', () => {
    const bet = parseSpokenBet('over under 12.5 points', roster, { now });
    expect(bet).toMatchObject({ marketType: 'over_under', line: 12.5, unit: 'pts' });
    expect(bet.title.length).toBeGreaterThan(0);
  });

  it('handles "a hundred and twenty bucks"', () => {
    const bet = parseSpokenBet('over under a hundred and twenty bucks on the round', roster, { now });
    expect(bet).toMatchObject({ marketType: 'over_under', line: 120, unit: '$', title: 'On the round' });
  });

  it('handles percent, hours with "point", thousands with commas, and a $ prefix', () => {
    expect(parseSpokenBet('over under seventy five percent attendance', roster, { now })).toMatchObject({ line: 75, unit: '%' });
    expect(parseSpokenBet('over under two point five hours of sleep', roster, { now })).toMatchObject({ line: 2.5, unit: 'hrs' });
    expect(parseSpokenBet('Over/under 1,000 dollars raised', roster, { now })).toMatchObject({ line: 1000, unit: '$' });
    expect(parseSpokenBet('over under $50 spent at the bar', roster, { now })).toMatchObject({ line: 50, unit: '$' });
    expect(parseSpokenBet('over under one thousand steps', roster, { now })).toMatchObject({ line: 1000 });
  });

  it('keeps zero as a real line', () => {
    const bet = parseSpokenBet('over under zero texts from Priya', roster, { now });
    expect(bet.line).toBe(0);
    expect(bet.marketType).toBe('over_under');
  });

  it('turns a spoken clock time into the time line format', () => {
    const bet = parseSpokenBet('over under ten thirty pm Jake gets home', roster, { now });
    expect(bet).toMatchObject({ marketType: 'over_under', line: 22 * 60 + 30, unit: 'time', title: 'Jake gets home' });
    expect(parseSpokenBet('over under 10:30 Jake gets home', roster, { now })).toMatchObject({ line: 10 * 60 + 30, unit: 'time' });
    expect(parseSpokenBet('over under 7pm Jake gets home', roster, { now })).toMatchObject({ line: 19 * 60, unit: 'time' });
    expect(parseSpokenBet('over under midnight', roster, { now })).toMatchObject({ line: 0, unit: 'time' });
  });

  it('turns a spoken calendar date into the date line format, next occurrence', () => {
    const bet = parseSpokenBet('over under March 5th Jake proposes', roster, { now });
    expect(bet).toMatchObject({ marketType: 'over_under', unit: 'date', title: 'Jake proposes' });
    expect(bet.line).toBe(Date.UTC(2027, 2, 5) / 1000);
    expect(parseSpokenBet('over under the twenty first of December', roster, { now }).line).toBe(Date.UTC(2026, 11, 21) / 1000);
  });

  it('reads "5 drinks by 10 pm" as the 5, not the 10', () => {
    const bet = parseSpokenBet('over under 5 drinks by 10 pm', roster, { now });
    expect(bet.line).toBe(5);
    expect(bet.unit).toBeUndefined();
  });

  it('still picks over_under with no number, leaving the line for the user', () => {
    const bet = parseSpokenBet('over under on how long the speech goes', roster, { now });
    expect(bet.marketType).toBe('over_under');
    expect(bet.line).toBeUndefined();
    expect(bet.title).toBe('On how long the speech goes');
  });
});

describe('parseSpokenBet: most likely to', () => {
  it('pre-picks roster names and strips them off the question', () => {
    const bet = parseSpokenBet("who's most likely to fall asleep first, Jake or Sam", roster, { now });
    expect(bet.marketType).toBe('most_likely_to');
    expect(bet.title).toBe("Who's most likely to fall asleep first?");
    expect(bet.prePickedNicknames).toEqual(['Jake', 'Sam']);
  });

  it('works without a "who" and with no names spoken', () => {
    const bet = parseSpokenBet('most likely to get kicked out', roster, { now });
    expect(bet).toMatchObject({ marketType: 'most_likely_to', title: "Who's most likely to get kicked out?", prePickedNicknames: [] });
  });

  it('matches nicknames case-insensitively, including multi-word ones', () => {
    const bet = parseSpokenBet('who is the most likely to cry: PRIYA, big mike and Sam', roster, { now });
    expect(bet.prePickedNicknames).toEqual(['Sam', 'Priya', 'Big Mike']);
    expect(bet.title).toBe("Who's most likely to cry?");
  });

  it('does not match a nickname inside another word', () => {
    const bet = parseSpokenBet('most likely to be sampled by the band', roster, { now });
    expect(bet.prePickedNicknames).toEqual([]);
  });
});

describe('parseSpokenBet: when, yes / no, and the rest', () => {
  it('a yes / no question that merely contains "when is" stays yes / no', () => {
    const bet = parseSpokenBet('will Jake remember when is the party', roster, { now });
    expect(bet.marketType).toBe('yes_no');
    expect(bet.title).toBe('Will Jake remember when is the party?');
  });

  it('"bet on when does" mid-sentence is a when market titled from the when', () => {
    const bet = parseSpokenBet('ok so bet on when does the bar open', roster, { now });
    expect(bet).toEqual({ marketType: 'when', title: 'When does the bar open?' });
  });

  it('"most likely to" in the middle of a will-question stays yes / no', () => {
    const bet = parseSpokenBet('will Jake be most likely to fail', roster, { now });
    expect(bet.marketType).toBe('yes_no');
    expect(bet.prePickedNicknames).toBeUndefined();
  });

  it("a filler lead-in before \"who's most likely to\" still counts", () => {
    const bet = parseSpokenBet("ok so who's most likely to cry, Sam", roster, { now });
    expect(bet.marketType).toBe('most_likely_to');
    expect(bet.title).toBe("Who's most likely to cry?");
  });

  it('"when will" is a when market', () => {
    const bet = parseSpokenBet('when will Jake finally text her back', roster, { now });
    expect(bet).toEqual({ marketType: 'when', title: 'When will Jake finally text her back?' });
  });

  it('"will X" is yes / no with a question mark', () => {
    const bet = parseSpokenBet('will Jake finish the marathon', roster, { now });
    expect(bet).toEqual({ marketType: 'yes_no', title: 'Will Jake finish the marathon?' });
  });

  it('drops leading filler the recognizer kept', () => {
    expect(parseSpokenBet('ok so, will Jake finish the marathon', roster, { now }).title).toBe('Will Jake finish the marathon?');
    expect(parseSpokenBet('I bet that Sam shows up late', roster, { now }).title).toBe('Sam shows up late');
  });

  it('nonsense is a yes / no market with the transcript as its title', () => {
    const bet = parseSpokenBet('banana banana purple', roster, { now });
    expect(bet).toEqual({ marketType: 'yes_no', title: 'Banana banana purple' });
  });

  it('an empty transcript is an empty yes / no', () => {
    expect(parseSpokenBet('   ', roster, { now })).toEqual({ marketType: 'yes_no', title: '' });
  });

  it('caps the title at the market title limit on a word boundary', () => {
    const long = `will ${'Jake '.repeat(60)}finish`;
    const bet = parseSpokenBet(long, roster, { now });
    expect(bet.title.length).toBeLessThanOrEqual(140);
    expect(bet.title.endsWith(' ')).toBe(false);
  });
});
