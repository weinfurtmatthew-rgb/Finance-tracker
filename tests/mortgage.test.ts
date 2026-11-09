import { describe, expect, it } from 'vitest';
import { mortgage, priceThatFits } from '../src/lib/mortgage';

const base = { price: 50_000_000, down: 10_000_000, rate: 0.065, years: 30, taxRate: 0.011, insurance: 200_000, hoa: 0, pmiRate: 0.005, extra: 0 };

describe('mortgage', () => {
  it('works out the monthly cost: principal and interest, tax and insurance', () => {
    const m = mortgage(base);
    // $400,000 at 6.5% for 30 years.
    expect([m.loan, m.principalAndInterest, m.tax, m.insurance, m.pmi]).toEqual([40_000_000, 252_827, 45_833, 16_667, 0]);
    expect(m.monthly).toBe(252_827 + 45_833 + 16_667);
    expect(m.months).toBe(360);
    // About $510,000 of interest over the loan.
    expect(Math.abs(m.totalInterest - (252_827 * 360 - 40_000_000))).toBeLessThan(10_000);
    expect(m.balances[0]).toBe(40_000_000);
    expect(m.balances).toHaveLength(31);
    expect(m.balances.at(-1)).toBe(0);
  });

  it('adds PMI under 20% down, until the balance is 78% of the price', () => {
    const m = mortgage({ ...base, down: 5_000_000 });
    expect(m.pmi).toBe(Math.round((45_000_000 * 0.005) / 12));
    expect(m.monthly).toBe(m.principalAndInterest + m.tax + m.insurance + m.pmi);
    // $450,000 down to $390,000 takes about 8 to 9 years at this rate.
    expect(m.pmiMonths).toBeGreaterThan(90);
    expect(m.pmiMonths).toBeLessThan(115);
    expect(mortgage({ ...base, down: 5_000_000, extra: 50_000 }).pmiMonths).toBeLessThan(m.pmiMonths);
  });

  it('pays off sooner with extra each month, and with less interest', () => {
    const m = mortgage({ ...base, extra: 50_000 });
    expect(m.months).toBeLessThan(300);
    expect(m.baseMonths).toBe(360);
    expect(m.baseInterest - m.totalInterest).toBeGreaterThan(10_000_000);
  });

  it('handles no interest, and nothing borrowed', () => {
    expect(mortgage({ ...base, rate: 0 }).principalAndInterest).toBe(Math.round(40_000_000 / 360));
    const cash = mortgage({ ...base, down: 60_000_000 });
    expect([cash.loan, cash.principalAndInterest, cash.months, cash.monthly]).toEqual([0, 0, 0, 45_833 + 16_667]);
  });

  it('finds the price whose monthly cost fits a budget', () => {
    const { price: _, down: __, ...costs } = base;
    const budget = mortgage(base).monthly;
    const fits = priceThatFits(costs, 0.2, budget);
    expect(fits).toBeGreaterThanOrEqual(49_900_000);
    expect(fits).toBeLessThanOrEqual(50_000_000);
    expect(mortgage({ ...base, price: fits, down: Math.round(fits * 0.2) }).monthly).toBeLessThanOrEqual(budget);
    expect(priceThatFits(costs, 0.2, 0)).toBe(0);
  });
});
