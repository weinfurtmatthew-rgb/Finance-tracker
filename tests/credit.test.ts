import { describe, expect, it } from 'vitest';
import {
  creditBand,
  currentScore,
  goalStatus,
  isScore,
  landlordCredit,
  lastChange,
  nextStatementClose,
  scoreChangeIn,
  scoreDue,
  statementPayments,
  typicalApr,
  utilization,
  type CreditScore,
} from '../src/lib/credit';
import { makeBook } from '../src/lib/networth';
import { planSnapshot } from '../src/lib/planData';
import { moneyHealth, type HealthInput } from '../src/lib/health';
import { buildRecap, yearPeriod } from '../src/lib/recap';
import { recapCards } from '../src/lib/recapCards';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import type { Account } from '../src/types';

const acct = (id: string, type: Account['type'], extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type,
  institution: '',
  openingBalance: 0,
  archived: false,
  createdAt: 0,
  ...extra,
});
const score = (date: string, n: number): CreditScore => ({ id: date, date, score: n });

describe('credit scores', () => {
  it('names the range a score is in, the way FICO does', () => {
    expect([850, 800, 799, 740, 739, 670, 669, 580, 579, 300].map(creditBand)).toEqual([
      'Exceptional',
      'Exceptional',
      'Very good',
      'Very good',
      'Good',
      'Good',
      'Fair',
      'Fair',
      'Poor',
      'Poor',
    ]);
    expect([300, 850, 712].every(isScore)).toBe(true);
    expect([299, 851, 712.5].some(isScore)).toBe(false);
  });

  it('uses the latest score from the last year, and asks for a new one a month on', () => {
    const scores = [score('2026-06-01', 690), score('2026-08-03', 712)];
    expect(currentScore(scores, '2026-09-29')?.score).toBe(712);
    expect(currentScore(scores, '2027-08-04')).toBeUndefined();
    expect(scoreDue(scores, '2026-09-01')).toBe(false);
    expect(scoreDue(scores, '2026-09-02')).toBe(true);
    expect(scoreDue([], '2026-09-02')).toBe(false); // only once you've started
    expect(lastChange(scores)).toMatchObject({ change: 22, since: { date: '2026-06-01' } });
  });

  it('says how a year went: from the score before it, or the first one in it', () => {
    const scores = [score('2025-11-20', 650), score('2026-03-01', 680), score('2026-10-01', 702)];
    expect(scoreChangeIn(scores, '2026-01-01', '2026-12-31')).toEqual({ start: 650, end: 702, change: 52 });
    expect(scoreChangeIn(scores.slice(1), '2026-01-01', '2026-12-31')).toEqual({ start: 680, end: 702, change: 22 });
    expect(scoreChangeIn([score('2026-03-01', 680)], '2026-01-01', '2026-12-31')).toEqual({ end: 680 });
    expect(scoreChangeIn(scores, '2027-01-01', '2027-12-31')).toBeUndefined();
  });

  it('tracks a goal: progress, the pace you’re going, and when you’d get there', () => {
    const goal = { target: 750, from: 690, setOn: '2026-04-01', by: '2027-06-30' };
    const scores = [score('2026-04-01', 690), score('2026-07-01', 705), score('2026-10-01', 720)];
    const g = goalStatus(goal, scores, '2026-10-15')!;
    expect(g).toMatchObject({ latest: 720, toGo: 30, progress: 0.5, reached: false });
    // 15 points in about 3 months (the last 6 months' scores): 5 a month, 6 more months to go.
    expect(g.perMonth).toBeCloseTo(5, 0);
    expect(g.eta).toMatch(/^2027-0[34]/);
    expect(g.onPace).toBe(true);
    expect(goalStatus({ ...goal, by: '2026-12-31' }, scores, '2026-10-15')!.onPace).toBe(false);
    expect(goalStatus(goal, [...scores, score('2026-10-10', 755)], '2026-10-15')).toMatchObject({ toGo: 0, progress: 1, reached: true });
    expect(goalStatus(goal, [], '2026-10-15')).toBeNull();
  });
});

describe('card limits', () => {
  const discover = acct('discover', 'credit', { openingBalance: -150_000, creditLimit: 500_000, statementDay: 12 });
  const amex = acct('amex', 'credit', { openingBalance: -20_000, creditLimit: 1_000_000 });
  const noLimit = acct('chase', 'credit', { openingBalance: -30_000 });
  const book = makeBook([discover, amex, noLimit], [], []);

  it('shows how much of your limits you use, each card and all together', () => {
    const u = utilization([discover, amex, noLimit], book);
    expect(u.cards.map((c) => [c.account.id, c.owed, c.use])).toEqual([
      ['discover', 150_000, 0.3],
      ['amex', 20_000, 0.02],
    ]);
    expect([u.owed, u.limit]).toEqual([170_000, 1_500_000]);
    expect(u.use).toBeCloseTo(0.1133, 3);
    expect(u.withoutLimit.map((a) => a.id)).toEqual(['chase']);
    expect(utilization([noLimit], book).use).toBeNull();
  });

  it('knows when a statement closes next, in short months too', () => {
    expect(nextStatementClose(12, '2026-09-29')).toBe('2026-10-12');
    expect(nextStatementClose(12, '2026-10-12')).toBe('2026-10-12');
    expect(nextStatementClose(31, '2026-09-15')).toBe('2026-09-30');
    expect(nextStatementClose(30, '2027-02-03')).toBe('2027-02-28');
  });

  it('says what to pay before a statement closes so it reports under 10%', () => {
    // $1,500 on a $5,000 limit closing in 3 days: pay $1,000 to report $500.
    expect(statementPayments([discover, amex], book, '2026-10-09').map((p) => [p.account.id, p.closes, p.pay])).toEqual([['discover', '2026-10-12', 100_000]]);
    expect(statementPayments([discover], book, '2026-10-01')).toEqual([]); // more than 5 days away
    const low = acct('low', 'credit', { openingBalance: -50_500, creditLimit: 500_000, statementDay: 12 });
    expect(statementPayments([low], makeBook([low], [], []), '2026-10-09')).toEqual([]); // $5 over: not worth it
  });
});

describe('what a score means elsewhere', () => {
  it('starts calculators at a typical rate for your range', () => {
    expect(typicalApr('card', 812)).toBe(0.19);
    expect(typicalApr('card', 600)).toBe(0.25);
    expect(typicalApr('loan', 760)).toBe(0.065);
    expect(typicalApr('loan', 560)).toBe(0.16);
    const card = acct('card', 'credit', { openingBalance: -100_000 });
    const typed = acct('typed', 'credit', { openingBalance: -100_000, apr: 0.18 });
    const snap = planSnapshot({
      accounts: [card, typed],
      book: makeBook([card, typed], [], []),
      txns: [],
      months: new Map(),
      today: '2026-09-29',
      creditScore: 590,
    });
    expect(snap.debts.map((d) => d.apr)).toEqual([0.25, 0.18]);
    expect(snap.creditScore).toBe(590);
  });

  it('says what landlords usually look for', () => {
    expect(landlordCredit(700).ok).toBe(true);
    expect(landlordCredit(630)).toMatchObject({ ok: false, text: expect.stringContaining('bigger deposit') });
    expect(landlordCredit(560).text).toContain('co-signer');
  });

  it('is a part of Money Health once you’ve added a score or a limit, without changing anyone’s score who hasn’t', () => {
    const base: HealthInput = {
      months: 3,
      monthlyIncome: 500_000,
      monthlySpending: 400_000,
      cash: 1_200_000,
      invested: 0,
      debt: 0,
      lateBills: 0,
      lateFees: 0,
      budgets: 0,
      goals: 0,
      tracked: 0,
      has: { cash: true, invest: true, debt: true },
    };
    const credit = (i: HealthInput) => moneyHealth(i)!.pillars.find((p) => p.key === 'credit')!;
    expect(credit(base)).toMatchObject({ score: null, metric: 'No credit score or card limits added' });
    expect(credit({ ...base, creditScore: 740 })).toMatchObject({ score: 85, metric: 'Score 740' });
    expect(credit({ ...base, creditUse: { owed: 50_000, limit: 1_000_000 } })).toMatchObject({ score: 100, metric: '5% of card limits used' });
    const both = credit({ ...base, creditScore: 670, creditUse: { owed: 500_000, limit: 1_000_000 } });
    expect(both.score).toBe(Math.round(0.6 * 60 + 0.4 * 40));
    expect(both.tip).toBe('Paying $2,000 off your cards gets you under 30% of your limits.');
    // Without credit info, the overall score is what it was.
    const before = moneyHealth(base)!.score;
    expect(before).toBe(Math.round(0.25 * 100 + 0.15 * 100 + 0.2 * 75 + 0.15 * 15 + 0.15 * 100 + 0.1 * 0));
  });
});

describe('credit in Year in Review', () => {
  it('shows how your score moved over the year', () => {
    const checking = acct('chk', 'checking');
    const txns = [
      {
        id: 't',
        accountId: 'chk',
        date: '2026-03-01',
        amount: -5_000,
        description: 'X',
        payee: 'X',
        categoryId: 'dining',
        notes: '',
        source: 'csv' as const,
        createdAt: 0,
      },
    ];
    const recap = (creditScores: CreditScore[]) =>
      buildRecap({
        period: yearPeriod(2026, '2026-09-29'),
        txns,
        accounts: [checking],
        book: makeBook([checking], txns, []),
        categories: DEFAULT_CATEGORIES,
        recurring: [],
        budgets: [],
        goals: [],
        creditScores,
      });
    const r = recap([score('2025-12-01', 680), score('2026-09-01', 712)]);
    expect(r.credit).toEqual({ start: 680, end: 712, change: 32 });
    const card = recapCards(r, new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]))).find((c) => c.key === 'credit')!;
    expect([card.big, card.sub]).toEqual(['712', 'Up 32 points, from 680']);
    expect(recap([]).credit).toBeUndefined();
  });
});
