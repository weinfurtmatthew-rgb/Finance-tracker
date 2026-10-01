/**
 * Money Health: a 0–100 score for the bigger picture, made of six parts you can act on. It moves
 * slowly (it's built from monthly averages and balances), unlike Spend Readiness, which is about today.
 */
import type { Cents } from '../types';

export type PillarKey = 'earn' | 'bills' | 'cushion' | 'invest' | 'debt' | 'planning';
export type Band = 'Great' | 'Good' | 'Fair' | 'Needs work';

export interface Pillar {
  key: PillarKey;
  name: string;
  weight: number;
  score: number;
  band: Band;
  /** Where you are, in a line. */
  metric: string;
  /** The next step, in a line. */
  tip: string;
}

export interface Health {
  score: number;
  band: Band;
  pillars: Pillar[];
}

export interface HealthInput {
  /** Full months the averages come from: with none, there's nothing to score yet. */
  months: number;
  monthlyIncome: Cents;
  monthlySpending: Cents;
  /** Checking, savings & cash. */
  cash: Cents;
  invested: Cents;
  /** Credit cards and loans (what you owe, not counting a mortgage). */
  debt: Cents;
  /** Bills overdue right now, and late or overdraft fees in the last 12 months. */
  lateBills: number;
  lateFees: number;
  budgets: number;
  goals: number;
  tracked: number;
}

export const bandFor = (score: number): Band => (score >= 85 ? 'Great' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : 'Needs work');

/** Straight-line steps between points [[x, y], …], flat beyond the ends. */
function curve(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

const money = (c: Cents) => `$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function moneyHealth(input: HealthInput): Health | null {
  if (input.months < 1 || input.monthlySpending <= 0) return null;
  const pillars: Omit<Pillar, 'band'>[] = [];
  const spend = input.monthlySpending;

  // 1. Spend less than you earn
  const rate = input.monthlyIncome > 0 ? (input.monthlyIncome - spend) / input.monthlyIncome : -1;
  pillars.push({
    key: 'earn',
    name: 'Spend less than you earn',
    weight: 0.25,
    score: curve(rate, [[-0.2, 0], [0, 40], [0.1, 75], [0.2, 100]]),
    metric: input.monthlyIncome > 0 ? (rate >= 0 ? `Saving ${Math.round(rate * 100)}% of what comes in` : `Spending ${Math.round(-rate * 100)}% more than comes in`) : 'No income found yet',
    tip: rate >= 0.2 ? 'Keep it above 20% and this stays strong.' : `Saving ${money(Math.max(0, 0.2 * input.monthlyIncome - (input.monthlyIncome - spend)))} more a month gets you to 20%.`,
  });

  // 2. Bills on time
  const misses = input.lateBills + input.lateFees;
  pillars.push({
    key: 'bills',
    name: 'Bills on time',
    weight: 0.15,
    score: Math.max(0, 100 - 25 * input.lateBills - 15 * input.lateFees),
    metric: misses ? [input.lateBills && `${plural(input.lateBills, 'bill')} overdue`, input.lateFees && `${plural(input.lateFees, 'late or overdraft fee')} this year`].filter(Boolean).join(' · ') : 'No late bills or late fees this year',
    tip: misses ? 'Turning on autopay for the bills that slip keeps fees away.' : 'Nothing to do. Keep it up.',
  });

  // 3. Cash cushion
  const months = input.cash / spend;
  pillars.push({
    key: 'cushion',
    name: 'Cash cushion',
    weight: 0.2,
    score: curve(months, [[0, 0], [1, 35], [3, 75], [6, 100]]),
    metric: `${months.toFixed(1)} months of spending in cash · aim for 3–6`,
    tip: months >= 3 ? 'A solid emergency fund. Extra cash could be invested.' : `${money((3 - months) * spend)} more gets you to 3 months.`,
  });

  // 4. Long-term savings: investments against a year of spending.
  const years = input.invested / (spend * 12);
  pillars.push({
    key: 'invest',
    name: 'Long-term savings',
    weight: 0.15,
    score: input.invested > 0 ? curve(years, [[0, 20], [0.5, 55], [1, 70], [3, 90], [5, 100]]) : 15,
    metric: input.invested > 0 ? `${money(input.invested)} invested · ${years.toFixed(1)} years of spending` : 'No investments tracked yet',
    tip: input.invested > 0 ? 'Steady monthly contributions are what move this.' : 'Add your retirement or brokerage accounts in Net Worth to count them.',
  });

  // 5. Debt load: cards and loans against a month of income.
  const debtMonths = input.monthlyIncome > 0 ? input.debt / input.monthlyIncome : input.debt > 0 ? 12 : 0;
  pillars.push({
    key: 'debt',
    name: 'Debt load',
    weight: 0.15,
    score: curve(debtMonths, [[0, 100], [1, 80], [3, 55], [6, 30], [12, 0]]),
    metric: input.debt > 0 ? `${money(input.debt)} on cards & loans · ${debtMonths.toFixed(1)} months of income` : 'No card or loan balances',
    tip: input.debt > 0 ? 'Paying the highest-rate balance first saves the most (see Plan → Debt payoff).' : 'Debt-free. Nice.',
  });

  // 6. Planning
  const planScore = Math.min(40, input.budgets * 10) + (input.goals ? 30 : 0) + Math.min(30, input.tracked * 10);
  pillars.push({
    key: 'planning',
    name: 'Planning',
    weight: 0.1,
    score: planScore,
    metric: [plural(input.budgets, 'budget'), plural(input.goals, 'goal'), `${input.tracked} bills tracked`].join(' · '),
    tip: input.budgets < 4 ? 'Budgets for your biggest categories keep surprises small.' : !input.goals ? 'A savings goal gives your extra money a job.' : input.tracked < 3 ? 'Confirm your subscriptions and bills in Recurring.' : 'Well planned.',
  });

  const out = pillars.map((p) => ({ ...p, score: Math.round(p.score), band: bandFor(Math.round(p.score)) }));
  const score = Math.round(out.reduce((s, p) => s + p.weight * p.score, 0));
  return { score, band: bandFor(score), pillars: out };
}

/** Late, overdraft and returned-payment fees in someone's history: what "Bills on time" counts. */
export const LATE_FEE = /\b(late (fee|charge|payment)|overdraft|nsf|returned (item|payment))\b/i;
