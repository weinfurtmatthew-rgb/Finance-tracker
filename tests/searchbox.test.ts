import { describe, expect, it } from 'vitest';
import { addRecent, looksLikeQuestion, topHit } from '../src/lib/search';

describe('looksLikeQuestion', () => {
  it('sends questions to Ask and leaves plain searches alone', () => {
    expect(looksLikeQuestion('how much did I spend on dining')).toBe(true);
    expect(looksLikeQuestion('Am I over budget')).toBe(true);
    expect(looksLikeQuestion('coffee?')).toBe(true);
    expect(looksLikeQuestion('coffee')).toBe(false);
    expect(looksLikeQuestion('who')).toBe(false);
    expect(looksLikeQuestion('Showtime')).toBe(false);
    expect(looksLikeQuestion('  ')).toBe(false);
  });
});

describe('addRecent', () => {
  it('puts the newest first without repeats', () => {
    expect(addRecent(['coffee', 'Target'], 'target')).toEqual(['target', 'coffee']);
    expect(addRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(addRecent(['a'], '  ')).toEqual(['a']);
  });
});

describe('topHit', () => {
  const cats = [
    { id: 'dining', name: 'Dining' },
    { id: 'coffee', name: 'Coffee' },
    { id: 'gas', name: 'Gas & Fuel' },
  ];
  const places = [
    { key: 'starbucks', name: 'Starbucks', count: 12 },
    { key: 'shell', name: 'Shell', count: 1 },
    { key: 'whole foods', name: 'Whole Foods', count: 4 },
  ];
  it('prefers an exact name, then a category, then a regular store', () => {
    expect(topHit('coffee', cats, places)).toEqual({ kind: 'category', id: 'coffee' });
    expect(topHit('starbucks', cats, places)).toEqual({ kind: 'place', key: 'starbucks' });
    expect(topHit('fuel', cats, places)).toEqual({ kind: 'category', id: 'gas' });
    expect(topHit('star', cats, places)).toEqual({ kind: 'place', key: 'starbucks' });
    expect(topHit('foods', cats, places)).toEqual({ kind: 'place', key: 'whole foods' });
    // One visit isn't enough for a guess, but typing the whole name is.
    expect(topHit('she', cats, places)).toBeNull();
    expect(topHit('shell', cats, places)).toEqual({ kind: 'place', key: 'shell' });
    expect(topHit('s', cats, places)).toBeNull();
  });
});
