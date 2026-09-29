import { describe, expect, it } from 'vitest';
import { checkRent, extrasShare, rentFor, rentLimits, yourCost, type RentInputs } from '../src/lib/rent';

const base: RentInputs = {
  takeHome: 500_000,
  otherCosts: 250_000,
  savingsGoal: 100_000,
  people: 1,
  includeExtras: false,
  utilities: 18_000,
  splitUtilities: true,
  personalExtras: 4_000,
  grossYearly: 0,
};

describe('rent calculator', () => {
  it('uses the % rules when your budget has room', () => {
    const l = rentLimits({ ...base, otherCosts: 150_000 });
    expect(l).toMatchObject({ cheapMax: 125_000, acceptableMax: 150_000, limitedBy: 'rule', budgetRoom: 250_000 });
  });

  it('lets your real budget lower the limits (cheap keeps a cushion on top of saving)', () => {
    const l = rentLimits({ ...base, otherCosts: 300_000 });
    // $5,000 − $3,000 other − $1,000 saving leaves $1,000 for housing: below the 30% rule.
    expect(l).toMatchObject({ acceptableMax: 100_000, cheapMax: 50_000, limitedBy: 'budget' });
  });

  it('never goes below zero when costs already use up take-home', () => {
    const l = rentLimits({ ...base, otherCosts: 450_000 });
    expect(l.acceptableMax).toBe(0);
    expect(l.cheapMax).toBe(0);
    expect(l.budgetRoom).toBe(-50_000);
    expect(checkRent({ ...base, otherCosts: 450_000 }, 100_000).tier).toBe('expensive');
  });

  it('splits rent evenly and utilities optionally, and gives the whole place’s rent', () => {
    const i = { ...base, people: 3, includeExtras: true };
    expect(extrasShare(i)).toBe(6_000 + 4_000);
    expect(extrasShare({ ...i, splitUtilities: false })).toBe(18_000 + 4_000);
    expect(extrasShare({ ...i, includeExtras: false })).toBe(0);
    expect(yourCost(i, 360_000)).toBe(130_000);
    expect(rentFor(i, 130_000)).toBe(360_000);
    const l = rentLimits(i);
    expect(l).toMatchObject({ cheapMax: 100_000, acceptableMax: 150_000, cheapRent: 270_000, acceptableRent: 420_000 });
  });

  it('checks a listing: tier, what is left, and what you can still save', () => {
    const i = { ...base, people: 3, includeExtras: true };
    expect(checkRent(i, 360_000)).toMatchObject({ tier: 'acceptable', cost: 130_000, rentShare: 120_000, leftOver: 120_000, saves: 100_000, savingsShort: 0 });
    expect(checkRent(i, 240_000).tier).toBe('cheap');
    const pricey = checkRent(i, 540_000);
    expect(pricey).toMatchObject({ tier: 'expensive', cost: 190_000, leftOver: 60_000, saves: 60_000, savingsShort: 40_000 });
    expect(pricey.ofTakeHome).toBeCloseTo(0.38);
  });

  it('runs the landlord check (40× rent) on your own share', () => {
    const i = { ...base, grossYearly: 6_000_000, people: 2 };
    const l = rentLimits(i);
    expect(l.landlordMax).toBe(150_000);
    expect(l.landlordMaxPlace).toBe(300_000);
    expect(checkRent(i, 300_000).landlordOk).toBe(true);
    expect(checkRent(i, 320_000).landlordOk).toBe(false);
    expect(checkRent(base, 100_000).landlordOk).toBeUndefined();
  });
});

describe('asking about rent', async () => {
  const { answer, parseQuestion, findAmount } = await import('../src/ai/ask');
  const { DEFAULT_CATEGORIES } = await import('../src/lib/categories');
  const ctx = { today: '2026-09-29', categories: DEFAULT_CATEGORIES, merchants: [] };
  const data = { rent: { takeHome: 500_000, otherCosts: 250_000 }, txns: [], categories: new Map(), recurring: [], budgets: [], netWorth: { net: 0, change: 0, since: '' } };

  it('answers what rent you can afford', () => {
    const q = parseQuestion('What rent can I afford?', ctx)!;
    expect(q.intent).toBe('rent');
    expect(answer(q, data).headline).toBe('Acceptable rent for you is up to $1,500.00 a month; under $1,000.00 is cheap.');
  });

  it('checks a rent amount', () => {
    const q = parseQuestion('can I afford $1,400 rent', ctx)!;
    expect(q).toMatchObject({ intent: 'rent', amount: 140_000 });
    expect(answer(q, data).headline).toBe('$1,400.00 rent is acceptable for you: 28% of your take-home.');
    expect(answer(parseQuestion('is 1.8k too much for an apartment', ctx)!, data).headline).toMatch(/^\$1,800\.00 rent is expensive/);
  });

  it('still answers spending questions about rent', () => {
    expect(parseQuestion('how much did I spend on rent last month', ctx)!.intent).toBe('spending');
    expect(findAmount('about 2 bucks')).toBe(200);
  });
});
