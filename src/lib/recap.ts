/**
 * Year in review: everything the recap cards show, computed from your data for a period (a calendar
 * year, this year so far, or the last 12 months). Every card is optional: when there isn't enough data
 * for it, it's left out rather than shown with a misleading number.
 */
import type { Account, Budget, Category, Cents, Goal, ISODate, Recurring, Transaction } from '../types';
import { addDays, addMonths, dayInMonth, diffDays, monthKey } from './dates';
import { balanceOn, netWorthOn, type BalanceBook } from './networth';
import { isLiability } from './balances';
import { lines, tagKey } from './lines';
import { countsAsCost, matchesRecurring } from './recurring';

export interface RecapPeriod {
  from: ISODate;
  to: ISODate;
  /** "2026", "2026 so far", "Last 12 months". */
  label: string;
  /** Short name used in sentences: "this year", "in 2025", "in the last 12 months". */
  phrase: string;
}

export function yearPeriod(year: number, today: ISODate): RecapPeriod {
  const current = Number(today.slice(0, 4)) === year;
  return {
    from: `${year}-01-01`,
    to: current ? today : `${year}-12-31`,
    label: current ? `${year} so far` : String(year),
    phrase: current ? 'this year' : `in ${year}`,
  };
}

export function last12Months(today: ISODate): RecapPeriod {
  return { from: addDays(dayInMonth(today, -12, Number(today.slice(8))), 1), to: today, label: 'Last 12 months', phrase: 'in the last 12 months' };
}

/** The same length of time just before `p`, for "vs last year". */
export function previousPeriod(p: RecapPeriod): RecapPeriod {
  const from = `${Number(p.from.slice(0, 4)) - 1}${p.from.slice(4)}`;
  const to = `${Number(p.to.slice(0, 4)) - 1}${p.to.slice(4)}`;
  return { from, to, label: `${from.slice(0, 4)}`, phrase: 'the year before' };
}

export interface Ranked {
  id: string;
  label: string;
  value: Cents;
  share: number;
  visits?: number;
}

export type Style = { name: string; emoji: string; why: string };

export interface Recap {
  period: RecapPeriod;
  /** Days covered by your data within the period (0 = nothing to show). */
  days: number;
  spent: Cents;
  earned: Cents;
  saved: Cents;
  savingsRate: number | null;
  topCategories: Ranked[];
  topMerchants: Ranked[];
  habit?: { name: string; visits: number; total: Cents; average: Cents; everyDays: number };
  biggest?: { payee: string; amount: Cents; date: ISODate; categoryId: string };
  months: { month: string; spent: Cents; earned: Cents }[];
  priciestMonth?: { month: string; spent: Cents };
  cheapestMonth?: { month: string; spent: Cents };
  noSpend?: { days: number; longest: number; longestFrom?: ISODate };
  weekdays?: { busiest: string; busiestShare: number; weekendDaily: Cents; weekdayDaily: Cents };
  subscriptions?: { total: Cents; count: number; added: string[]; cancelled: { name: string; saved: Cents }[] };
  /** `change` is only known when your data starts before the period. */
  netWorth?: { start: Cents; end: Cents; change: Cents; known: boolean };
  goalsReached: string[];
  emergencyMonths?: number;
  debt?: { start: Cents; end: Cents; paidDown: Cents };
  feesPaid: Cents;
  vsLastYear?: { spentBefore: Cents; up: Ranked[]; down: Ranked[] };
  trips: { tag: string; total: Cents; from: ISODate; to: ISODate }[];
  budgets?: { monthsUnder: number; monthsTracked: number };
  income?: { paychecks: number; total: Cents; mainPayer?: string; raise?: { from: Cents; to: Cents; pct: number } };
  style?: Style;
}

/** Bills and obligations: real spending, but not "places you went" or "purchases". */
const OBLIGATIONS = new Set(['housing', 'bills', 'insurance', 'subscriptions', 'car-payment', 'taxes', 'fees', 'education']);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (d: ISODate) => new Date(`${d}T12:00:00Z`).getUTCDay();

export function buildRecap(args: {
  period: RecapPeriod;
  txns: Transaction[];
  accounts: Account[];
  book: BalanceBook;
  categories: Category[];
  recurring: Recurring[];
  budgets: Budget[];
  goals: Goal[];
}): Recap {
  const { period, txns, book } = args;
  const cats = new Map(args.categories.map((c) => [c.id, c]));
  const group = (id: string) => cats.get(id)?.group;
  const inP = (d: ISODate) => d >= period.from && d <= period.to;
  const inPeriod = txns.filter((t) => inP(t.date));
  const ls = lines(inPeriod);
  const expense = ls.filter((l) => group(l.categoryId) === 'expense');
  const income = ls.filter((l) => group(l.categoryId) === 'income');
  const spent = -expense.reduce((s, l) => s + l.amount, 0);
  const earned = income.reduce((s, l) => s + l.amount, 0);

  // How much of the period your data actually covers.
  const dates = inPeriod.map((t) => t.date).sort();
  const days = dates.length ? diffDays(dates[0], period.to) + 1 : 0;

  // Categories & merchants.
  const byCat = new Map<string, Cents>();
  for (const l of expense) byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0) - l.amount);
  const rank = (m: Map<string, Cents>, label: (id: string) => string, visits?: Map<string, number>): Ranked[] =>
    [...m]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, value]) => ({ id, label: label(id), value, share: spent > 0 ? value / spent : 0, visits: visits?.get(id) }));
  const topCategories = rank(byCat, (id) => cats.get(id)?.name ?? 'Other').slice(0, 6);
  const byPayee = new Map<string, Cents>();
  const visits = new Map<string, number>();
  const seen = new Set<string>();
  for (const l of expense) {
    if (OBLIGATIONS.has(l.categoryId)) continue;
    const p = l.payee || l.description;
    byPayee.set(p, (byPayee.get(p) ?? 0) - l.amount);
    // One visit per transaction, even when it's split.
    if (l.amount < 0 && !seen.has(l.id)) {
      seen.add(l.id);
      visits.set(p, (visits.get(p) ?? 0) + 1);
    }
  }
  const topMerchants = rank(byPayee, (id) => id, visits).slice(0, 5);

  // Your habit: the place you went most often (bills and subscriptions aren't habits).
  const costs = args.recurring.filter(countsAsCost);
  const fixedIds = new Set(inPeriod.filter((t) => costs.some((r) => matchesRecurring(r, t))).map((t) => t.id));
  const habitCandidates = [...visits].filter(([p]) => !expense.some((l) => (l.payee || l.description) === p && fixedIds.has(l.id)));
  const top = habitCandidates.sort((a, b) => b[1] - a[1])[0];
  const habit =
    top && top[1] >= 6
      ? { name: top[0], visits: top[1], total: byPayee.get(top[0]) ?? 0, average: Math.round((byPayee.get(top[0]) ?? 0) / top[1]), everyDays: Math.max(1, Math.round(days / top[1])) }
      : undefined;

  const biggestLine = expense.filter((l) => l.amount < 0 && !OBLIGATIONS.has(l.categoryId)).sort((a, b) => a.amount - b.amount)[0];
  const biggest = biggestLine ? { payee: biggestLine.payee, amount: -biggestLine.amount, date: biggestLine.date, categoryId: biggestLine.categoryId } : undefined;

  // Months (only full months count for most/least expensive).
  const monthMap = new Map<string, { spent: Cents; earned: Cents }>();
  for (let m = monthKey(period.from); m <= monthKey(period.to); m = addMonths(m, 1)) monthMap.set(m, { spent: 0, earned: 0 });
  for (const l of expense) monthMap.get(monthKey(l.date))!.spent -= l.amount;
  for (const l of income) monthMap.get(monthKey(l.date))!.earned += l.amount;
  const months = [...monthMap].map(([month, v]) => ({ month, ...v }));
  const firstData = dates[0] ? monthKey(dates[0]) : '9999-99';
  const full = months.filter((m) => m.month > firstData && m.month < monthKey(period.to) && m.spent > 0);
  const byMonthSpend = [...full].sort((a, b) => b.spent - a.spent);
  const priciestMonth = byMonthSpend.length >= 3 ? byMonthSpend[0] : undefined;
  const cheapestMonth = byMonthSpend.length >= 3 ? byMonthSpend[byMonthSpend.length - 1] : undefined;

  // No-spend days: days without everyday (non-bill) spending, from your first transaction on.
  let noSpend: Recap['noSpend'];
  if (dates.length && days >= 28) {
    const spendDays = new Set(expense.filter((l) => l.amount < 0 && !fixedIds.has(l.id)).map((l) => l.date));
    let count = 0;
    let run = 0;
    let longest = 0;
    let longestFrom: ISODate | undefined;
    let runStart = dates[0];
    for (let d = dates[0]; d <= period.to; d = addDays(d, 1)) {
      if (spendDays.has(d)) {
        run = 0;
        continue;
      }
      count++;
      if (run === 0) runStart = d;
      run++;
      if (run > longest) {
        longest = run;
        longestFrom = runStart;
      }
    }
    noSpend = { days: count, longest, longestFrom };
  }

  // When you spend.
  let weekdays: Recap['weekdays'];
  const flexible = expense.filter((l) => l.amount < 0 && !fixedIds.has(l.id));
  if (flexible.length >= 20) {
    const perDay = new Array(7).fill(0);
    for (const l of flexible) perDay[weekday(l.date)] -= l.amount;
    const totalFlex = perDay.reduce((s, v) => s + v, 0);
    const busiest = perDay.indexOf(Math.max(...perDay));
    const dayCount = new Array(7).fill(0);
    for (let d = dates[0]; d <= period.to; d = addDays(d, 1)) dayCount[weekday(d)]++;
    const weekend = (perDay[0] + perDay[6]) / Math.max(1, dayCount[0] + dayCount[6]);
    const weekdaysAvg = (totalFlex - perDay[0] - perDay[6]) / Math.max(1, dayCount.slice(1, 6).reduce((s, v) => s + v, 0));
    weekdays = { busiest: WEEKDAYS[busiest], busiestShare: totalFlex ? perDay[busiest] / totalFlex : 0, weekendDaily: Math.round(weekend), weekdayDaily: Math.round(weekdaysAvg) };
  }

  // Subscriptions: what they cost this period, which started, which you cancelled (and what that saved).
  let subscriptions: Recap['subscriptions'];
  const subs = args.recurring.filter((r) => r.kind === 'subscription');
  if (subs.length) {
    let total = 0;
    let count = 0;
    const added: string[] = [];
    const cancelled: { name: string; saved: Cents }[] = [];
    for (const r of subs) {
      const history = txns.filter((t) => matchesRecurring(r, t)).sort((a, b) => (a.date < b.date ? -1 : 1));
      const here = history.filter((t) => inP(t.date));
      if (here.length) {
        count++;
        total -= here.reduce((s, t) => s + t.amount, 0);
      }
      if (history.length && inP(history[0].date) && history[0].date > dates[0]) added.push(r.name);
      if (r.status === 'cancelled' && r.cancelledOn && inP(r.cancelledOn)) {
        const last = history.at(-1);
        const monthsSince = Math.max(0, Math.floor(diffDays(r.cancelledOn, period.to) / 30.44));
        cancelled.push({ name: r.name, saved: last ? -last.amount * monthsSince : 0 });
      }
    }
    if (count || cancelled.length) subscriptions = { total, count, added, cancelled };
  }

  // Net worth, debt and goals.
  const startDay = addDays(period.from, -1);
  const open = args.accounts.filter((a) => !a.archived);
  let netWorth: Recap['netWorth'];
  // Your data has to start before the period for a "change" to mean anything.
  const firstEver = txns.reduce((m, t) => (t.date < m ? t.date : m), '9999-12-31');
  const knownStart = firstEver < period.from;
  if (open.length) {
    const start = netWorthOn(book, startDay).net;
    const end = netWorthOn(book, period.to).net;
    netWorth = { start, end, change: end - start, known: knownStart };
  }
  const liabilities = open.filter(isLiability);
  let debt: Recap['debt'];
  if (liabilities.length) {
    const owed = (d: ISODate) => liabilities.reduce((s, a) => s - balanceOn(book, a, d), 0);
    const start = owed(startDay);
    const end = owed(period.to);
    const liabilityStart = txns.filter((t) => liabilities.some((a) => a.id === t.accountId)).reduce((m, t) => (t.date < m ? t.date : m), '9999-12-31');
    if (liabilityStart < period.from && (start > 0 || end > 0)) debt = { start, end, paidDown: start - end };
  }
  const goalsReached = args.goals
    .filter((g) => {
      const a = open.find((x) => x.id === g.accountId);
      return !!a && balanceOn(book, a, period.to) >= g.target && balanceOn(book, a, startDay) < g.target;
    })
    .map((g) => `${g.emoji} ${g.name}`);
  const cash = open.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash').reduce((s, a) => s + balanceOn(book, a, period.to), 0);
  const monthsCovered = Math.max(1, days / 30.44);
  const emergencyMonths = spent > 0 && days >= 60 ? cash / (spent / monthsCovered) : undefined;
  const feesPaid = -expense.filter((l) => l.categoryId === 'fees').reduce((s, l) => s + l.amount, 0);

  // Vs the year before, for the same stretch of dates.
  let vsLastYear: Recap['vsLastYear'];
  const prev = previousPeriod(period);
  const prevLines = lines(txns.filter((t) => t.date >= prev.from && t.date <= prev.to)).filter((l) => group(l.categoryId) === 'expense');
  const prevDays = new Set(prevLines.map((l) => monthKey(l.date))).size;
  if (prevDays >= 3) {
    const before = new Map<string, Cents>();
    for (const l of prevLines) before.set(l.categoryId, (before.get(l.categoryId) ?? 0) - l.amount);
    const ids = new Set([...before.keys(), ...byCat.keys()]);
    const diffs = [...ids].map((id) => ({ id, label: cats.get(id)?.name ?? 'Other', value: (byCat.get(id) ?? 0) - (before.get(id) ?? 0), share: 0 }));
    vsLastYear = {
      spentBefore: -prevLines.reduce((s, l) => s + l.amount, 0),
      up: diffs.filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 3),
      down: diffs.filter((d) => d.value < 0).sort((a, b) => a.value - b.value).slice(0, 3),
    };
  }

  // Trips & events (tags).
  const tagMap = new Map<string, { tag: string; total: Cents; from: ISODate; to: ISODate }>();
  for (const l of expense)
    for (const tag of l.tags ?? []) {
      const k = tagKey(tag);
      const e = tagMap.get(k) ?? { tag, total: 0, from: l.date, to: l.date };
      e.total -= l.amount;
      if (l.date < e.from) e.from = l.date;
      if (l.date > e.to) e.to = l.date;
      tagMap.set(k, e);
    }
  const trips = [...tagMap.values()].filter((t) => t.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);

  // Budgets: full months where everyday spending stayed within today's total budget.
  let budgets: Recap['budgets'];
  const limit = args.budgets.reduce((s, b) => s + b.limit, 0);
  if (limit > 0 && full.length) {
    const budgeted = new Set(args.budgets.map((b) => b.categoryId));
    let under = 0;
    for (const m of full) {
      const flex = -flexible.filter((l) => monthKey(l.date) === m.month && budgeted.has(l.categoryId)).reduce((s, l) => s + l.amount, 0);
      if (flex <= limit) under++;
    }
    budgets = { monthsUnder: under, monthsTracked: full.length };
  }

  // Income: paychecks from your main payer, and whether they went up.
  let incomeCard: Recap['income'];
  if (income.length) {
    const byPayer = new Map<string, Transaction[]>();
    for (const l of income) if (l.categoryId === 'income') byPayer.set(l.payee, [...(byPayer.get(l.payee) ?? []), l]);
    const main = [...byPayer].sort((a, b) => b[1].length - a[1].length)[0];
    let raise: { from: Cents; to: Cents; pct: number } | undefined;
    if (main && main[1].length >= 6) {
      const sorted = [...main[1]].sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => t.amount);
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const from = median(sorted.slice(0, 3));
      const to = median(sorted.slice(-3));
      if (to > from * 1.02) raise = { from, to, pct: to / from - 1 };
    }
    incomeCard = { paychecks: main ? main[1].length : 0, total: earned, mainPayer: main?.[0], raise };
  }

  const savingsRate = earned > 0 ? (earned - spent) / earned : null;
  const r: Recap = {
    period,
    days,
    spent,
    earned,
    saved: earned - spent,
    savingsRate,
    topCategories,
    topMerchants,
    habit,
    biggest,
    months,
    priciestMonth,
    cheapestMonth,
    noSpend,
    weekdays,
    subscriptions,
    netWorth,
    goalsReached,
    emergencyMonths,
    debt,
    feesPaid,
    vsLastYear,
    trips,
    budgets,
    income: incomeCard,
  };
  r.style = spendingStyle(r, byCat, spent);
  return r;
}

/** A playful label from how your spending is spread across categories. */
export function spendingStyle(r: Pick<Recap, 'savingsRate'>, byCat: Map<string, Cents>, spent: Cents): Style | undefined {
  if (spent <= 0) return undefined;
  const share = (...ids: string[]) => ids.reduce((s, id) => s + (byCat.get(id) ?? 0), 0) / spent;
  const styles: [number, Style][] = [
    [share('travel') / 0.15, { name: 'The Explorer', emoji: '🧭', why: 'Travel took a big slice of your spending.' }],
    [share('dining', 'coffee', 'alcohol') / 0.25, { name: 'The Foodie', emoji: '🍜', why: 'Eating and drinking out was a favorite.' }],
    [share('shopping', 'clothing', 'electronics') / 0.25, { name: 'The Collector', emoji: '🛍️', why: 'You love a good find.' }],
    [share('groceries', 'home') / 0.3, { name: 'The Homebody', emoji: '🏡', why: 'Groceries and home came first.' }],
    [share('gas', 'transport', 'car-payment', 'car-maintenance') / 0.2, { name: 'The Road Warrior', emoji: '🚗', why: 'Getting around was a big part of your year.' }],
    [share('entertainment', 'subscriptions') / 0.15, { name: 'The Fun Seeker', emoji: '🎟️', why: 'Entertainment and streaming made the list.' }],
    [share('fitness', 'health') / 0.1, { name: 'The Athlete', emoji: '🏅', why: 'You invested in your health.' }],
    [(r.savingsRate ?? 0) / 0.3, { name: 'The Saver', emoji: '🐿️', why: 'You kept a big share of what you earned.' }],
  ];
  const [score, style] = styles.sort((a, b) => b[0] - a[0])[0];
  return score >= 1 ? style : { name: 'The All-Rounder', emoji: '⚖️', why: 'Your spending was nicely spread out.' };
}

/** Whether the recap should open by itself: once in December (this year) and early January (last year). */
export function autoRecapYear(today: ISODate): number | null {
  const [y, m, d] = today.split('-').map(Number);
  if (m === 12) return y;
  if (m === 1 && d <= 15) return y - 1;
  return null;
}
