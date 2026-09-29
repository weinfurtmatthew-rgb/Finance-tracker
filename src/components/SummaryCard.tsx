import { useMemo } from 'preact/hooks';
import { byId, useBook, useCategories, useTransactions } from '../hooks';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { addMonths, dayInMonth, monthKey } from '../lib/dates';
import { budgetProgress } from '../lib/budgets';
import { changeSince } from '../lib/networth';
import { factSentences, summaryFacts } from '../ai/summary';

/** A short written recap of the month, computed exactly from your data. */
export function SummaryCard(props: { month: string }) {
  const txns = useTransactions();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const rec = useRecurringModel();
  const { months, budgets } = useSpending();
  const book = useBook();
  const today = rec.today;
  const current = monthKey(today) === props.month;

  const sentences = useMemo(() => {
    const lastMonthEnd = dayInMonth(`${addMonths(monthKey(today), -1)}-01`, 0, 31);
    const facts = summaryFacts({
      month: props.month,
      today,
      months,
      categories: cats,
      budgets: current ? budgetProgress(budgets, months.get(props.month), props.month, today) : [],
      recurring: current ? rec.statuses : [],
      netWorthChange: current ? changeSince(book, lastMonthEnd).total : undefined,
      txnsByDay: (month, lastDay) =>
        -txns
          .filter((t) => t.date.startsWith(month) && Number(t.date.slice(8)) <= lastDay && cats.get(t.categoryId)?.group === 'expense')
          .reduce((s, t) => s + t.amount, 0),
    });
    return factSentences(facts);
  }, [props.month, today, months, cats, budgets, rec.statuses, book, txns, current]);

  if (!sentences.length) return null;
  return (
    <div class="summary-card">
      <span class="card-label">{current ? 'This month so far' : 'Month in review'}</span>
      <p>{sentences.join(' ')}</p>
    </div>
  );
}
