/** The monthly recap: a few plain sentences, computed exactly from your data. */
import type { Category, Cents, ISODate } from '../types';
import { addMonths, dayOfMonth, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import type { BudgetProgress, MonthSpending } from '../lib/budgets';
import type { RecurringStatus } from '../lib/recurring';

export interface SummaryFacts {
  month: string;
  label: string;
  current: boolean;
  spent: Cents;
  /** Spending in the previous month over the same days (month-to-date comparison for the current month). */
  previous: Cents;
  topCategory?: { name: string; amount: Cents };
  biggestJump?: { name: string; amount: Cents; average: Cents };
  over: string[];
  near: string[];
  income: Cents;
  priceIncreases: string[];
  netWorthChange?: Cents;
}

export function summaryFacts(args: {
  month: string;
  today: ISODate;
  months: Map<string, MonthSpending>;
  categories: Map<string, Category>;
  txnsByDay: (month: string, lastDay: number) => Cents;
  budgets: BudgetProgress[];
  recurring: RecurringStatus[];
  netWorthChange?: Cents;
}): SummaryFacts {
  const { month, months } = args;
  const m = months.get(month);
  const current = monthKey(args.today) === month;
  const spent = (m?.flexible ?? 0) + (m?.fixed ?? 0);
  const previous = current ? args.txnsByDay(addMonths(month, -1), dayOfMonth(args.today)) : (months.get(addMonths(month, -1))?.flexible ?? 0) + (months.get(addMonths(month, -1))?.fixed ?? 0);
  const name = (id: string) => args.categories.get(id)?.name ?? id;
  const cats = [...(m?.allByCategory ?? [])].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = cats[0];
  let biggestJump: SummaryFacts['biggestJump'];
  for (const [id, v] of cats) {
    const avg = [1, 2, 3].reduce((s, i) => s + Math.max(0, months.get(addMonths(month, -i))?.allByCategory.get(id) ?? 0), 0) / 3;
    const jump = v - avg;
    if (avg > 0 && jump > 5000 && jump / avg > 0.25 && (!biggestJump || jump > biggestJump.amount - biggestJump.average)) {
      biggestJump = { name: name(id), amount: v, average: Math.round(avg) };
    }
  }
  return {
    month,
    label: monthLabel(month),
    current,
    spent,
    previous,
    topCategory: top ? { name: name(top[0]), amount: top[1] } : undefined,
    biggestJump,
    over: args.budgets.filter((b) => b.state === 'over').map((b) => name(b.categoryId)),
    near: args.budgets.filter((b) => b.state === 'warning').map((b) => name(b.categoryId)),
    income: Math.max(0, m?.income ?? 0),
    priceIncreases: args.recurring.filter((s) => s.priceChange).map((s) => s.rec.name),
    netWorthChange: args.netWorthChange,
  };
}

const $ = (c: Cents) => formatMoney(c, { whole: true });
const pct = (a: number, b: number) => Math.round((Math.abs(a - b) / b) * 100);

/** Plain sentences, always correct. */
export function factSentences(f: SummaryFacts): string[] {
  const s: string[] = [];
  const when = f.current ? 'so far this month' : `in ${f.label}`;
  if (f.spent <= 0) return [`No spending recorded ${when} yet.`];
  if (f.previous > 0) {
    const diff = f.spent - f.previous;
    const dir = diff > 0 ? 'more' : 'less';
    s.push(`You've spent ${$(f.spent)} ${when}, ${pct(f.spent, f.previous)}% ${dir} than ${f.current ? 'at this point last month' : 'the month before'} (${$(f.previous)}).`);
  } else s.push(`You've spent ${$(f.spent)} ${when}.`);
  if (f.topCategory) s.push(`The biggest category is ${f.topCategory.name} at ${$(f.topCategory.amount)}.`);
  if (f.biggestJump && f.biggestJump.name !== f.topCategory?.name) s.push(`${f.biggestJump.name} is up: ${$(f.biggestJump.amount)} vs your usual ${$(f.biggestJump.average)}.`);
  if (f.over.length) s.push(`Over budget: ${f.over.join(', ')}.`);
  else if (f.near.length) s.push(`Close to the limit: ${f.near.join(', ')}.`);
  if (f.income > 0 && !f.current) s.push(`Income was ${$(f.income)}, so you ${f.income >= f.spent ? `saved ${$(f.income - f.spent)}` : `spent ${$(f.spent - f.income)} more than you earned`}.`);
  if (f.priceIncreases.length) s.push(`Price went up: ${f.priceIncreases.join(', ')}.`);
  if (f.netWorthChange != null && f.current && f.netWorthChange !== 0) s.push(`Net worth is ${f.netWorthChange > 0 ? 'up' : 'down'} ${$(Math.abs(f.netWorthChange))} since last month.`);
  return s;
}
