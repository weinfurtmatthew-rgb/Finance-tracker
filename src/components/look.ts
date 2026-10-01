/**
 * How categories and recurring items look: built-in categories get a line icon on a chip in their
 * color family (food is orange, getting around is violet, shopping is magenta…). A category you made,
 * or a built-in one you gave your own emoji, keeps its emoji.
 */
import type { Category, RecurringKind } from '../types';
import { DEFAULT_CATEGORIES } from '../lib/categories';
import type { GlyphName, Hue } from './icons';

const BUILT_IN: Record<string, [GlyphName, Hue]> = {
  income: ['income', 'aqua'],
  interest: ['trend', 'aqua'],
  investments: ['bars', 'aqua'],
  groceries: ['cart', 'green'],
  home: ['plant', 'green'],
  fitness: ['dumbbell', 'green'],
  dining: ['dining', 'orange'],
  coffee: ['coffee', 'orange'],
  alcohol: ['wine', 'orange'],
  pets: ['paw', 'orange'],
  gas: ['fuel', 'violet'],
  transport: ['car', 'violet'],
  'car-payment': ['key', 'violet'],
  'car-maintenance': ['wrench', 'violet'],
  subscriptions: ['repeat', 'violet'],
  shopping: ['bag', 'magenta'],
  clothing: ['shirt', 'magenta'],
  entertainment: ['play', 'magenta'],
  personal: ['scissors', 'magenta'],
  gifts: ['gift', 'magenta'],
  charity: ['heart', 'magenta'],
  bills: ['bolt', 'yellow'],
  housing: ['home', 'yellow'],
  kids: ['balloon', 'yellow'],
  electronics: ['phone', 'blue'],
  travel: ['plane', 'blue'],
  education: ['school', 'blue'],
  insurance: ['shield', 'blue'],
  health: ['cross', 'red'],
  fees: ['receipt', 'red'],
  owed: ['users', 'red'],
  taxes: ['bank', 'gray'],
  other: ['box', 'gray'],
  uncategorized: ['help', 'gray'],
  'card-payment': ['card', 'gray'],
  transfer: ['swap', 'gray'],
};

const DEFAULTS = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

export type Look =
  /** A line icon on a chip: `background` is a CSS color. */
  | { glyph: GlyphName; background: string }
  /** An emoji on a soft tint of the category's color. */
  | { emoji: string; background: string };

/** A deeper shade of any color, for a chip that white icons read well on. */
const deepen = (color: string) => `color-mix(in oklab, ${color} 74%, #000)`;

export function categoryLook(c: Category | undefined): Look {
  if (!c) return { glyph: 'help', background: 'var(--deep-gray)' };
  const builtIn = BUILT_IN[c.id];
  const original = DEFAULTS.get(c.id);
  if (builtIn && original && original.emoji === c.emoji) {
    // A recolored built-in keeps its icon in the chosen color.
    return { glyph: builtIn[0], background: original.color === c.color ? `var(--deep-${builtIn[1]})` : deepen(c.color) };
  }
  return { emoji: c.emoji || '❔', background: `color-mix(in srgb, ${c.color || '#8e8e93'} 22%, transparent)` };
}

const KIND_LOOK: Record<RecurringKind, [GlyphName, Hue]> = {
  subscription: ['repeat', 'violet'],
  bill: ['bolt', 'yellow'],
  loan: ['home', 'yellow'],
  'card-payment': ['card', 'gray'],
  income: ['income', 'aqua'],
  trial: ['hourglass', 'blue'],
};

export function kindLook(kind: RecurringKind): Look {
  const [glyph, hue] = KIND_LOOK[kind];
  return { glyph, background: `var(--deep-${hue})` };
}
