import { describe, expect, it } from 'vitest';
import { categoryLook, kindLook } from '../src/components/look';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Category, RecurringKind } from '../src/types';

const builtIn = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)!;

describe('categoryLook', () => {
  it('gives every built-in category a line icon on its color family', () => {
    for (const c of DEFAULT_CATEGORIES) {
      const look = categoryLook(c);
      expect('glyph' in look, c.id).toBe(true);
      expect(look.background, c.id).toMatch(/^var\(--deep-[a-z]+\)$/);
    }
    expect(categoryLook(builtIn('dining'))).toEqual({ glyph: 'dining', background: 'var(--deep-orange)' });
    expect(categoryLook(builtIn('groceries'))).toEqual({ glyph: 'cart', background: 'var(--deep-green)' });
  });

  it('keeps your own emoji, on a built-in category too', () => {
    expect(categoryLook({ ...builtIn('coffee'), emoji: '🧋' })).toEqual({ emoji: '🧋', background: expect.stringContaining('#a2845e') });
    const mine: Category = { id: 'c-123', name: 'Climbing', emoji: '🧗', color: '#30b0c7', group: 'expense', order: 40 };
    expect(categoryLook(mine)).toEqual({ emoji: '🧗', background: expect.stringContaining('#30b0c7') });
  });

  it('follows a new color you gave a built-in category', () => {
    const look = categoryLook({ ...builtIn('dining'), color: '#5856d6' });
    expect(look).toMatchObject({ glyph: 'dining' });
    expect(look.background).toContain('#5856d6');
  });

  it('shows a question mark without a category', () => {
    expect(categoryLook(undefined)).toEqual({ glyph: 'help', background: 'var(--deep-gray)' });
  });
});

describe('kindLook', () => {
  it('has an icon for every kind of recurring item', () => {
    for (const kind of ['subscription', 'bill', 'loan', 'card-payment', 'income', 'trial'] as RecurringKind[]) {
      expect('glyph' in kindLook(kind), kind).toBe(true);
    }
  });
});
