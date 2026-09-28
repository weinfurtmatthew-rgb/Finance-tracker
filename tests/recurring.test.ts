import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, detectPattern, detectRecurring, matchesRecurring, nextOnSchedule, occurrences, priceIncreased,
  recurringStatus, snapToSchedule, suggestionToRecurring, upcoming,
} from '../src/lib/recurring';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Recurring, Transaction } from '../src/types';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
let n = 0;
const tx = (date: string, amount: number, payee: string, categoryId = 'other', description = payee.toUpperCase()): Transaction => ({
  id: `t${n++}`, accountId: 'acct', date, amount, description, payee, categoryId, notes: '', source: 'csv', createdAt: 0,
});
const monthly = (payee: string, amount: number, day: number, months: string[], categoryId = 'subscriptions') =>
  months.map((m) => tx(`${m}-${String(day).padStart(2, '0')}`, amount, payee, categoryId));
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

describe('detectPattern', () => {
  it('monthly with a little drift', () => {
    expect(detectPattern(['2026-05-03', '2026-06-02', '2026-07-03', '2026-08-04', '2026-09-03'])).toEqual({ frequency: 'monthly', dayOfMonth: 3 });
  });
  it('monthly tolerates one missing month', () => {
    expect(detectPattern(['2026-04-10', '2026-05-10', '2026-07-10', '2026-08-10', '2026-09-10'])?.frequency).toBe('monthly');
  });
  it('every two weeks', () => {
    expect(detectPattern(['2026-07-03', '2026-07-17', '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11'])).toEqual({ frequency: 'biweekly' });
  });
  it('twice a month (1st & 15th, with weekend shifts)', () => {
    expect(detectPattern(['2026-06-01', '2026-06-15', '2026-07-01', '2026-07-15', '2026-07-31', '2026-08-14', '2026-09-01', '2026-09-15'])).toEqual({
      frequency: 'semimonthly',
      days: [1, 15],
    });
  });
  it('twice a month (15th & last day)', () => {
    // 31 is clamped to each month's length, i.e. "the last day".
    expect(detectPattern(['2026-06-15', '2026-06-30', '2026-07-15', '2026-07-31', '2026-08-14', '2026-08-31', '2026-09-15', '2026-09-30'])).toEqual({
      frequency: 'semimonthly',
      days: [15, 31],
    });
  });
  it('weekly', () => {
    expect(detectPattern(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'])).toEqual({ frequency: 'weekly' });
  });
  it('yearly from two charges', () => {
    expect(detectPattern(['2025-03-14', '2026-03-14'])).toEqual({ frequency: 'yearly', dayOfMonth: 14 });
  });
  it('rejects random purchases', () => {
    expect(detectPattern(['2026-08-01', '2026-08-04', '2026-08-19', '2026-09-20', '2026-09-22'])).toBeNull();
  });
});

describe('schedules', () => {
  const s = { frequency: 'monthly' as const, dayOfMonth: 31 };
  it('clamps to short months', () => {
    expect(occurrences('2026-01-31', '2026-05-31', s)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  it('an early payment counts for the upcoming due date', () => {
    const r = { frequency: 'monthly' as const, dayOfMonth: 1 };
    expect(nextOnSchedule(snapToSchedule('2026-09-29', r), r)).toBe('2026-11-01');
    expect(nextOnSchedule(snapToSchedule('2026-10-03', r), r)).toBe('2026-11-01');
  });
  it('twice a month', () => {
    const r = { frequency: 'semimonthly' as const, days: [1, 15] as [number, number] };
    expect(occurrences('2026-09-15', '2026-10-31', r)).toEqual(['2026-09-15', '2026-10-01', '2026-10-15']);
  });
});

describe('detectRecurring', () => {
  it('finds subscriptions, splits Apple by amount, finds paychecks and card payments', () => {
    const txns = [
      ...monthly('Netflix', -1549, 2, MONTHS),
      ...monthly('Apple', -299, 5, MONTHS),
      ...monthly('Apple', -1099, 19, MONTHS),
      ...['2026-07-03', '2026-07-17', '2026-07-31', '2026-08-14', '2026-08-28', '2026-09-11', '2026-09-25'].map((d) => tx(d, 240000, 'Acme Corp Payroll', 'income')),
      ...monthly('Discover E-Payment', -41233, 20, MONTHS, 'transfer'),
      ...monthly('Eversource', -9000, 12, MONTHS.slice(0, 2), 'bills'),
      tx('2026-06-12', -14000, 'Eversource', 'bills'), // variable amounts still one bill
      tx('2026-07-12', -6000, 'Eversource', 'bills'),
      tx('2026-08-12', -11000, 'Eversource', 'bills'),
      tx('2026-09-12', -8000, 'Eversource', 'bills'),
      tx('2026-08-10', -500, 'Starbucks', 'dining'),
      tx('2026-08-17', -650, 'Starbucks', 'dining'),
      tx('2026-09-02', -450, 'Starbucks', 'dining'),
      ...monthly('Hulu', -799, 8, ['2026-03', '2026-04', '2026-05']), // stopped in May
    ];
    const found = detectRecurring(txns, cats, [], new Set());
    const byName = Object.fromEntries(found.map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(['Acme Corp Payroll', 'Apple ($10.99)', 'Apple ($2.99)', 'Discover E-Payment', 'Eversource', 'Netflix']);
    expect(byName['Netflix']).toMatchObject({ kind: 'subscription', frequency: 'monthly', amount: -1549, dayOfMonth: 2 });
    expect(byName['Apple ($2.99)']).toMatchObject({ matchAmount: -299, frequency: 'monthly' });
    expect(byName['Acme Corp Payroll']).toMatchObject({ kind: 'income', frequency: 'biweekly' });
    expect(byName['Discover E-Payment'].kind).toBe('card-payment');
    expect(byName['Eversource']).toMatchObject({ kind: 'bill', frequency: 'monthly' });
  });

  it('skips dismissed suggestions and ones already tracked', () => {
    const txns = [...monthly('Netflix', -1549, 2, MONTHS), ...monthly('Spotify', -1199, 9, MONTHS)];
    const netflix = suggestionToRecurring(detectRecurring(txns, cats, [], new Set()).find((s) => s.name === 'Netflix')!, 'subscription', 'r1');
    expect(detectRecurring(txns, cats, [netflix], new Set()).map((s) => s.name)).toEqual(['Spotify']);
    expect(detectRecurring(txns, cats, [netflix], new Set(['spotify|out']))).toEqual([]);
  });
});

describe('recurringStatus', () => {
  const base: Recurring = {
    id: 'r', name: 'Netflix', kind: 'subscription', frequency: 'monthly', match: 'netflix', amount: -1549, dayOfMonth: 2,
    status: 'active', createdAt: 0,
  };
  const history = [tx('2026-07-02', -1549, 'Netflix'), tx('2026-08-02', -1549, 'Netflix'), tx('2026-09-02', -1799, 'Netflix')];

  it('next due comes from the latest matched charge', () => {
    const s = recurringStatus(base, history, '2026-09-28', DEFAULT_SETTINGS);
    expect(s.lastPaid).toBe('2026-09-02');
    expect(s.nextDue).toBe('2026-10-02');
    expect(s.late).toBe(false);
  });

  it('flags a price increase using the settings rule', () => {
    const s = recurringStatus(base, history, '2026-09-28', DEFAULT_SETTINGS);
    expect(s.priceChange).toMatchObject({ from: -1549, to: -1799 });
    expect(recurringStatus(base, history, '2026-09-28', { ...DEFAULT_SETTINGS, priceAlert: { mode: 'dollars', value: 5 } }).priceChange).toBeUndefined();
    expect(priceIncreased(-1000, -1040, { mode: 'percent', value: 5 })).toBe(false);
    expect(priceIncreased(-1000, -1001, { mode: 'any', value: 0 })).toBe(true);
    expect(priceIncreased(-1000, -1001, { mode: 'off', value: 0 })).toBe(false);
  });

  it("doesn't call a naturally varying bill a price increase", () => {
    const electric: Recurring = { ...base, name: 'Electric', match: 'eversource', kind: 'bill' };
    const bills = [tx('2026-07-12', -9000, 'Eversource'), tx('2026-08-12', -6000, 'Eversource'), tx('2026-09-12', -12000, 'Eversource')];
    expect(recurringStatus(electric, bills, '2026-09-28', DEFAULT_SETTINGS).priceChange).toBeUndefined();
  });

  it('expected amount follows the mode (default or per-bill override)', () => {
    // Netflix went from 15.49 to 17.99: the new price is the best guess, not the average.
    expect(recurringStatus(base, history, '2026-09-28', DEFAULT_SETTINGS).expected).toBe(-1799);
    const varying = [tx('2026-07-02', -9000, 'Netflix'), tx('2026-08-02', -6000, 'Netflix'), tx('2026-09-02', -12000, 'Netflix')];
    expect(recurringStatus(base, varying, '2026-09-28', DEFAULT_SETTINGS).expected).toBe(-9000);
    expect(recurringStatus(base, history, '2026-09-28', { ...DEFAULT_SETTINGS, amountMode: 'last' }).expected).toBe(-1799);
    expect(recurringStatus({ ...base, amountMode: 'manual', amount: -2000 }, history, '2026-09-28', DEFAULT_SETTINGS).expected).toBe(-2000);
  });

  it('manual "mark paid" moves the due date; a later import takes over', () => {
    const r = { ...base, lastPaidOn: '2026-10-02' };
    expect(recurringStatus(r, history, '2026-10-05', DEFAULT_SETTINGS).nextDue).toBe('2026-11-02');
    const imported = [...history, tx('2026-10-03', -1799, 'Netflix')];
    expect(recurringStatus(r, imported, '2026-10-05', DEFAULT_SETTINGS).nextDue).toBe('2026-11-02');
  });

  it('late when the due date passed with no charge', () => {
    const s = recurringStatus(base, history, '2026-10-06', DEFAULT_SETTINGS);
    expect(s.late).toBe(true);
  });

  it('cancelled: money saved and charges after cancelling', () => {
    const r: Recurring = { ...base, status: 'cancelled', cancelledOn: '2026-09-10' };
    const s = recurringStatus(r, history, '2026-12-15', { ...DEFAULT_SETTINGS, amountMode: 'last' });
    expect(s.saved).toBe(3 * 1799); // Oct, Nov, Dec
    expect(s.chargedAfterCancel).toBeUndefined();
    const s2 = recurringStatus(r, [...history, tx('2026-10-02', -1799, 'Netflix')], '2026-10-05', DEFAULT_SETTINGS);
    expect(s2.chargedAfterCancel?.date).toBe('2026-10-02');
  });

  it('matches Apple charges by amount when split', () => {
    const r: Recurring = { ...base, name: 'iCloud', match: 'apple', matchAmount: -299 };
    expect(matchesRecurring(r, tx('2026-09-05', -299, 'Apple'))).toBe(true);
    expect(matchesRecurring(r, tx('2026-09-05', -1099, 'Apple'))).toBe(false);
    expect(matchesRecurring(r, tx('2026-09-05', 299, 'Apple'))).toBe(false); // refund isn't a charge
  });
});

describe('upcoming', () => {
  it('lists late items once, then future due dates in order', () => {
    const r: Recurring = {
      id: 'r', name: 'Rent', kind: 'loan', frequency: 'monthly', match: 'rent', amount: -165000, dayOfMonth: 1, lastPaidOn: '2026-09-01', status: 'active', createdAt: 0,
    };
    const trial: Recurring = { id: 't', name: 'Max', kind: 'trial', frequency: 'monthly', match: 'max', amount: -1699, trialEndsOn: '2026-10-12', status: 'active', createdAt: 0 };
    const statuses = [r, trial].map((x) => recurringStatus(x, [], '2026-10-04', DEFAULT_SETTINGS));
    const items = upcoming(statuses, '2026-10-04', '2026-11-30');
    expect(items.map((i) => [i.status.rec.name, i.date, i.late])).toEqual([
      ['Rent', '2026-10-01', true],
      ['Max', '2026-10-12', false],
      ['Rent', '2026-11-01', false],
    ]);
  });
});
