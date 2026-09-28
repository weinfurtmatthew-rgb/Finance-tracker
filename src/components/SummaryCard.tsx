import { useEffect, useMemo, useState } from 'preact/hooks';
import { getMeta, setMeta } from '../db';
import { byId, useBook, useCategories, useTransactions } from '../hooks';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { addMonths, dayInMonth, monthKey } from '../lib/dates';
import { budgetProgress } from '../lib/budgets';
import { changeSince } from '../lib/networth';
import { hash } from '../lib/importer';
import { factSentences, numbersAreFaithful, summaryFacts, summaryMessages } from '../ai/summary';
import { chat, useAi } from '../ai/client';

/** A short written recap of the month. Plain facts always; reworded by the on-device model when it's on. */
export function SummaryCard(props: { month: string }) {
  const ai = useAi();
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

  const key = `summary:${props.month}:${hash(sentences.join('|'))}`;
  const [aiText, setAiText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setAiText(null);
    (async () => {
      const cached = await getMeta<string>(key);
      if (cached != null) return !cancelled && setAiText(cached || null);
      if (!ai.llm || sentences.length < 2) return;
      try {
        const out = (await chat(summaryMessages(sentences), 140)).trim();
        // Only keep the reworded version if every number in it came from the facts.
        const ok = out.length > 20 && numbersAreFaithful(out, sentences);
        await setMeta(key, ok ? out : '');
        if (!cancelled && ok) setAiText(out);
      } catch {
        /* keep the plain facts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ai.llm]);

  if (!sentences.length) return null;
  return (
    <div class="summary-card">
      <span class="card-label">
        {aiText ? '✨ ' : ''}
        {current ? 'This month so far' : 'Month in review'}
      </span>
      <p>{aiText ?? sentences.join(' ')}</p>
      {aiText && <span class="card-sub">Written on this phone by the on-device AI from your numbers.</span>}
    </div>
  );
}
