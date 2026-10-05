import { describe, expect, it } from 'vitest';
import { LATE_FEE, bandFor, moneyHealth, nextWin, type HealthInput } from '../src/lib/health';

const base: HealthInput = {
  months: 3,
  monthlyIncome: 500000,
  monthlySpending: 400000,
  cash: 1200000,
  invested: 0,
  debt: 0,
  lateBills: 0,
  lateFees: 0,
  budgets: 0,
  goals: 0,
  tracked: 0,
  has: { cash: true, invest: true, debt: true },
};

describe('moneyHealth', () => {
  it('needs some history', () => {
    expect(moneyHealth({ ...base, months: 0 })).toBeNull();
    expect(moneyHealth({ ...base, monthlySpending: 0 })).toBeNull();
  });

  it('scores each part and weights them into one number', () => {
    const h = moneyHealth(base)!;
    const by = Object.fromEntries(h.pillars.map((p) => [p.key, p.score]));
    expect(by).toEqual({ earn: 100, bills: 100, cushion: 75, invest: 15, debt: 100, planning: 0 });
    expect(h.score).toBe(Math.round(0.25 * 100 + 0.15 * 100 + 0.2 * 75 + 0.15 * 15 + 0.15 * 100 + 0.1 * 0));
    expect(h.band).toBe('Good');
    expect(h.pillars.find((p) => p.key === 'earn')!.metric).toBe('Saving 20% of what comes in');
  });

  it('marks down late bills, debt and overspending', () => {
    const h = moneyHealth({ ...base, monthlyIncome: 380000, lateBills: 1, lateFees: 2, debt: 1140000, cash: 100000 })!;
    const p = Object.fromEntries(h.pillars.map((x) => [x.key, x]));
    expect(p.bills.score).toBe(45);
    expect(p.bills.metric).toBe('1 bill overdue · 2 late or overdraft fees this year');
    expect(p.debt.score).toBe(55);
    expect(p.earn.metric).toBe('Spending 5% more than comes in');
    expect(h.band).toBe('Needs work');
  });

  it('rewards planning', () => {
    const h = moneyHealth({ ...base, budgets: 5, goals: 1, tracked: 4 })!;
    expect(h.pillars.find((p) => p.key === 'planning')!.score).toBe(100);
  });

  it("leaves out what it can't measure instead of scoring it low", () => {
    const h = moneyHealth({ ...base, monthlyIncome: 0, debt: 50000, has: { cash: true, invest: false, debt: true } })!;
    const p = Object.fromEntries(h.pillars.map((x) => [x.key, x]));
    expect(p.earn.score).toBeNull();
    expect(p.invest).toMatchObject({ score: null, band: null, metric: 'No investment accounts added' });
    expect(p.debt.score).toBe(0); // owing money with no income found
    // Bills 100, cushion 75, debt 0 and planning 0, weighted among themselves.
    expect(h.score).toBe(Math.round((0.15 * 100 + 0.2 * 75) / 0.6));
    expect(['debt', 'planning']).toContain(nextWin(h)!.key);
  });

  it('needs at least half the picture for an overall score', () => {
    expect(moneyHealth({ ...base, monthlyIncome: 0, has: { cash: true, invest: false, debt: false } })).toBeNull();
  });

  it('bands', () => {
    expect([100, 85, 84, 65, 64, 45, 44, 0].map(bandFor)).toEqual(['Great', 'Great', 'Good', 'Good', 'Fair', 'Fair', 'Needs work', 'Needs work']);
  });

  it('recognizes late and overdraft fees', () => {
    expect(['LATE FEE', 'Overdraft charge', 'NSF FEE', 'RETURNED PAYMENT FEE'].every((d) => LATE_FEE.test(d))).toBe(true);
    expect(['MONTHLY SERVICE FEE', 'Foreign transaction fee'].some((d) => LATE_FEE.test(d))).toBe(false);
  });
});
