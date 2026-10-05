/**
 * The Today screen's numbers: how this month's everyday spending is pacing, which categories are
 * running hot or cool against your usual, a 0–10 Spend Readiness score for today, and a few plain
 * sentences that say it all. Everything is computed from your own data, on the phone.
 */
import type { Category, Cents, ISODate, Recurring, Transaction } from '../types';
import { lines } from './lines';
import { addDays, addMonths, daysInMonth, dayOfMonth, monthKey } from './dates';
import { lineKinds } from './spend';

/** Months of history the "usual" is averaged over. */
const USUAL_MONTHS = 3;

export interface TodayFacts {
  today: ISODate;
  month: string;
  day: number;
  days: number;
  /** Everyday (flexible) spending so far this month, by day: index 0 is the 1st, cumulative. */
  curve: Cents[];
  spent: Cents;
  /** Average everyday spending by this day of the month, and for a whole month (previous months). */
  usualSoFar: Cents | null;
  usualMonth: Cents | null;
  /** This month so far and the usual by this day, per expense category. */
  byCategory: Map<string, Cents>;
  usualByCategory: Map<string, Cents>;
  /** Everyday spending in the last 7 days, and a typical week (the 13 weeks before). */
  last7: Cents;
  usual7: Cents | null;
}

/** Everyday spending only (see spend.ts): not bills, transfers or income. */
function* everyday(txns: Transaction[], cats: Map<string, Category>, recurring: Recurring[]) {
  const { kind } = lineKinds(cats, recurring);
  for (const t of lines(txns)) if (kind(t) === 'everyday') yield { date: t.date, categoryId: t.categoryId, spent: -t.amount };
}

export function todayFacts(txns: Transaction[], cats: Map<string, Category>, recurring: Recurring[], today: ISODate): TodayFacts {
  const month = monthKey(today);
  const [y, m] = month.split('-').map(Number);
  const days = daysInMonth(y, m);
  const day = dayOfMonth(today);
  const perDay = new Array<Cents>(day).fill(0);
  const byCategory = new Map<string, Cents>();
  const prior = Array.from({ length: USUAL_MONTHS }, (_, i) => addMonths(month, -(i + 1)));
  const priorSoFar = new Map<string, Cents>();
  const priorFull = new Map<string, Cents>();
  const priorByCat = new Map<string, Cents>();
  const weekFrom = addDays(today, -6);
  const historyFrom = addDays(today, -97);
  let last7 = 0;
  let history = 0;
  // Where the data starts (any transaction: the first file's first line).
  const firstDate = txns.reduce<ISODate | undefined>((m, t) => (!m || t.date < m ? t.date : m), undefined);

  for (const l of everyday(txns, cats, recurring)) {
    const key = monthKey(l.date);
    const d = dayOfMonth(l.date);
    if (key === month && d <= day) {
      perDay[d - 1] += l.spent;
      byCategory.set(l.categoryId, (byCategory.get(l.categoryId) ?? 0) + l.spent);
    } else if (prior.includes(key)) {
      priorFull.set(key, (priorFull.get(key) ?? 0) + l.spent);
      if (d <= day) {
        priorSoFar.set(key, (priorSoFar.get(key) ?? 0) + l.spent);
        priorByCat.set(l.categoryId, (priorByCat.get(l.categoryId) ?? 0) + l.spent);
      }
    }
    if (l.date >= weekFrom && l.date <= today) last7 += l.spent;
    else if (l.date >= historyFrom && l.date < weekFrom) history += l.spent;
  }

  // Only months the data covers (give or take a few quiet days at the start) count toward "usual": a
  // file starting mid-month would make that month look cheap.
  const covered = prior.filter((k) => firstDate && firstDate <= addDays(`${k}-01`, 6) && priorFull.has(k));
  const avg = (mp: Map<string, Cents>) => (covered.length ? Math.round(covered.reduce((s, k) => s + (mp.get(k) ?? 0), 0) / covered.length) : null);
  const usualByCategory = new Map<string, Cents>();
  if (covered.length) for (const [id, v] of priorByCat) usualByCategory.set(id, Math.round(v / covered.length));
  const curve: Cents[] = [];
  perDay.reduce((s, v) => (curve.push(s + v), s + v), 0);
  const hasHistory = !!firstDate && firstDate <= historyFrom;
  return {
    today,
    month,
    day,
    days,
    curve,
    spent: curve[curve.length - 1] ?? 0,
    usualSoFar: avg(priorSoFar),
    usualMonth: avg(priorFull),
    byCategory,
    usualByCategory: covered.length ? usualByCategory : new Map(),
    last7,
    usual7: hasHistory ? Math.round((history / 91) * 7) : null,
  };
}

/** What this month's everyday spending is measured against: your budgets, or your usual month. */
export interface Target {
  amount: Cents;
  kind: 'budget' | 'usual';
}

export function paceTarget(facts: TodayFacts, budgetTotal: Cents): Target | null {
  if (budgetTotal > 0) return { amount: budgetTotal, kind: 'budget' };
  if (facts.usualMonth && facts.usualMonth > 0) return { amount: facts.usualMonth, kind: 'usual' };
  return null;
}

/** Where an even pace would put you today, and how far ahead (+) or behind (−) of it you are. */
export function pace(facts: TodayFacts, target: Target) {
  const expected = Math.round((target.amount * facts.day) / facts.days);
  return { expected, under: expected - facts.spent, left: target.amount - facts.spent, daysLeft: facts.days - facts.day + 1 };
}

// ---------------------------------------------------------------- Spend Readiness

export type Verdict = 'Go For It' | 'On Track' | 'Pace Yourself' | 'Hold Off';

export interface ReadinessFactor {
  key: 'pace' | 'bills' | 'cushion' | 'momentum';
  label: string;
  weight: number;
  /** 0–1, or null when there isn't enough data (then it counts as a neutral 0.7). */
  value: number | null;
  detail: string;
}

export interface Readiness {
  score: number;
  verdict: Verdict;
  factors: ReadinessFactor[];
}

export interface ReadinessInput {
  facts: TodayFacts;
  target: Target | null;
  /** Cash in checking now, and what's due before the next paycheck (or in the next 7 days). */
  cash: Cents;
  billsDue: Cents;
  /** Checking, savings & cash, and a typical month of spending (for the cushion). */
  liquid: Cents;
  monthlySpending: Cents;
}

/** Straight-line steps between points [[x, y], …] (x ascending), flat beyond the ends. */
function curve(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

const NEUTRAL = 0.7;
const money = (c: Cents) => `$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;

export function verdictFor(score: number): Verdict {
  return score >= 9 ? 'Go For It' : score >= 7 ? 'On Track' : score >= 4 ? 'Pace Yourself' : 'Hold Off';
}

/**
 * How comfortable today is for spending, 0–10: pace against your budget or usual (40%), bills due
 * before payday against cash in checking (25%), your cash cushion in months (20%), and the last 7
 * days against a typical week (15%).
 */
export function spendReadiness(input: ReadinessInput): Readiness {
  const { facts, target } = input;
  const factors: ReadinessFactor[] = [];

  if (target && facts.day > 0) {
    const p = pace(facts, target);
    const ratio = p.expected > 0 ? facts.spent / p.expected : 0;
    factors.push({
      key: 'pace',
      label: 'Pace this month',
      weight: 0.4,
      value: curve(ratio, [[0.85, 1], [1, 0.7], [1.1, 0.4], [1.3, 0]]),
      detail: p.under >= 0 ? `${money(p.under)} under ${target.kind === 'budget' ? 'budget' : 'your usual'} pace` : `${money(p.under)} over ${target.kind === 'budget' ? 'budget' : 'your usual'} pace`,
    });
  } else factors.push({ key: 'pace', label: 'Pace this month', weight: 0.4, value: null, detail: 'Set budgets, or import a few months, to measure pace' });

  if (input.billsDue > 0) {
    const cover = input.cash / input.billsDue;
    factors.push({
      key: 'bills',
      label: 'Bills before payday',
      weight: 0.25,
      value: curve(cover, [[0, 0], [1, 0.55], [2, 0.85], [3, 1]]),
      detail: cover >= 1 ? `${money(input.billsDue)} due, covered by checking` : `${money(input.billsDue)} due, ${money(input.billsDue - input.cash)} more than checking holds`,
    });
  } else factors.push({ key: 'bills', label: 'Bills before payday', weight: 0.25, value: 1, detail: 'Nothing due before payday' });

  if (input.monthlySpending > 0) {
    const months = input.liquid / input.monthlySpending;
    factors.push({
      key: 'cushion',
      label: 'Cash cushion',
      weight: 0.2,
      value: curve(months, [[0, 0], [1, 0.4], [3, 0.8], [6, 1]]),
      detail: `${months.toFixed(1)} months of spending in cash`,
    });
  } else factors.push({ key: 'cushion', label: 'Cash cushion', weight: 0.2, value: null, detail: 'Not enough spending history yet' });

  if (facts.usual7 && facts.usual7 > 0) {
    const ratio = facts.last7 / facts.usual7;
    factors.push({
      key: 'momentum',
      label: 'Last 7 days',
      weight: 0.15,
      value: curve(ratio, [[0.8, 1], [1, 0.75], [1.5, 0.25], [2, 0]]),
      detail: `${money(facts.last7)} vs ${money(facts.usual7)} in a typical week`,
    });
  } else factors.push({ key: 'momentum', label: 'Last 7 days', weight: 0.15, value: null, detail: 'Not enough history for a typical week yet' });

  const total = factors.reduce((s, f) => s + f.weight * (f.value ?? NEUTRAL), 0);
  // Rounded down: a 9 or 10 has to be earned.
  const score = Math.max(0, Math.min(10, Math.floor(total * 10 + 1e-9)));
  return { score, verdict: verdictFor(score), factors };
}

// ---------------------------------------------------------------- Highlights & summary

export interface CategoryChange {
  categoryId: string;
  spent: Cents;
  usual: Cents;
  /** spent − usual by this day of the month. */
  diff: Cents;
}

/** Categories well above (hot) or below (cool) their usual by this point in the month, biggest first. */
export function categoryChanges(facts: TodayFacts): { hot: CategoryChange[]; cool: CategoryChange[] } {
  const ids = new Set([...facts.byCategory.keys(), ...facts.usualByCategory.keys()]);
  const all: CategoryChange[] = [];
  for (const id of ids) {
    const spent = Math.max(0, facts.byCategory.get(id) ?? 0);
    const usual = Math.max(0, facts.usualByCategory.get(id) ?? 0);
    all.push({ categoryId: id, spent, usual, diff: spent - usual });
  }
  // Worth mentioning: at least $25 and a quarter more (or less) than usual, on a category you use.
  const notable = (c: CategoryChange) => Math.abs(c.diff) >= 2500 && Math.abs(c.diff) >= 0.25 * Math.max(c.usual, 1) && c.usual >= 2000;
  return {
    hot: all.filter((c) => c.diff > 0 && notable(c)).sort((a, b) => b.diff - a.diff),
    cool: all.filter((c) => c.diff < 0 && notable(c)).sort((a, b) => a.diff - b.diff),
  };
}

/** A piece of a sentence; `tone` colors the numbers that matter. */
export interface Phrase {
  text: string;
  tone?: 'good' | 'bad';
}

export interface SummaryInput {
  facts: TodayFacts;
  target: Target | null;
  monthName: string;
  categoryName: (id: string) => string;
  bills: { count: number; total: Cents; payday?: { label: string; amount?: Cents }; covered: boolean };
}

/** "Your day in money": two or three friendly sentences built from the numbers above. */
export function todaySummary(input: SummaryInput): Phrase[][] {
  const { facts, target } = input;
  const out: Phrase[][] = [];
  if (!facts.spent && !facts.usualMonth) return out;

  if (target && facts.day > 3) {
    const p = pace(facts, target);
    const basis = target.kind === 'budget' ? '' : ' compared with your usual month';
    if (Math.abs(p.under) < 1000) out.push([{ text: `You’re right on pace for ${input.monthName}${basis}.` }]);
    else if (p.under > 0) out.push([{ text: 'You’re ' }, { text: `${money(p.under)} under pace`, tone: 'good' }, { text: ` for ${input.monthName}${basis}.` }]);
    else out.push([{ text: 'You’re ' }, { text: `${money(p.under)} over pace`, tone: 'bad' }, { text: ` for ${input.monthName}${basis}, so an easy few days would help.` }]);
  } else {
    out.push([{ text: `It’s early in ${input.monthName}: ${money(facts.spent)} of everyday spending so far.` }]);
  }

  const { hot, cool } = categoryChanges(facts);
  if (hot.length) {
    const c = hot[0];
    out.push([{ text: `${input.categoryName(c.categoryId)} is running hot: ` }, { text: `${money(c.diff)} more`, tone: 'bad' }, { text: ' than usual by this point.' }]);
  } else if (cool.length) {
    const c = cool[0];
    out.push([{ text: `${input.categoryName(c.categoryId)} is ` }, { text: `${money(c.diff)} under`, tone: 'good' }, { text: ' your usual. Nice.' }]);
  }

  const b = input.bills;
  if (b.count) {
    const what = `${b.count === 1 ? 'One bill lands' : `${b.count} bills land`}`;
    const when = b.payday ? ` before ${b.payday.label}’s paycheck` : ' in the next week';
    if (b.covered) out.push([{ text: `${what}${when} (${money(b.total)}), and you’re covered.` }]);
    else out.push([{ text: `${what}${when}: ` }, { text: `${money(b.total)}, more than checking holds`, tone: 'bad' }, { text: ' right now.' }]);
  }
  return out;
}
