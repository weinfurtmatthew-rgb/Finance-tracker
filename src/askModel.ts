import { useMemo } from 'preact/hooks';
import { allTags } from './lib/lines';
import { people } from './lib/p2p';
import { usePlanData } from './planModel';
import { byId, useBook, useCategories, useTransactions } from './hooks';
import { useRecurringModel } from './recurringModel';
import { useSpending } from './spendingModel';
import { addMonths, dayInMonth, formatShortDate, monthKey } from './lib/dates';
import { budgetProgress } from './lib/budgets';
import { changeSince, netWorthOn } from './lib/networth';
import { answer, understand, type Answer } from './ai/ask';
import { useAi } from './ai/client';
import { vectors } from './ai/vectors';
import { CATEGORY_SEEDS } from './ai/similar';

export interface Reply {
  question: string;
  answer?: Answer;
  error?: string;
}

/** Answers a question from everything on the phone; the on-device AI (when on) helps read it. */
export function useAsk() {
  const ai = useAi();
  const txns = useTransactions();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const rec = useRecurringModel();
  const { months, budgets } = useSpending();
  const book = useBook();
  const plan = usePlanData();
  const today = rec.today;
  const merchants = useMemo(() => [...new Set(txns.map((t) => t.payee).filter(Boolean))], [txns]);
  const tags = useMemo(() => allTags(txns).map((x) => x.tag), [txns]);
  const peopleNames = useMemo(() => people(txns).map((p) => p.name), [txns]);

  return async (question: string): Promise<Reply> => {
    const q = question.trim();
    const ctx = { today, categories, merchants, tags, people: peopleNames };
    let query = null;
    try {
      query = await understand(q, ctx, ai.embed ? vectors : undefined, CATEGORY_SEEDS);
    } catch {
      query = null;
    }
    if (!query) {
      return {
        question: q,
        error: ai.embed
          ? "Sorry, I couldn't work out what to look up. Try asking about spending, a category, a store, income, subscriptions, budgets or net worth."
          : "I couldn't understand that with the basic parser. Try one of the examples, or turn on on-device AI in Settings for more flexible questions.",
      };
    }
    const lastMonthEnd = dayInMonth(`${addMonths(monthKey(today), -1)}-01`, 0, 31);
    return {
      question: q,
      answer: answer(query, {
        rent: plan ? { takeHome: plan.monthlyIncome, otherCosts: Math.max(0, plan.monthlySpending - plan.monthlyHousing) } : undefined,
        txns,
        categories: cats,
        recurring: rec.statuses,
        budgets: budgetProgress(budgets, months.get(monthKey(today)), monthKey(today), today),
        netWorth: { net: netWorthOn(book).net, change: changeSince(book, lastMonthEnd).total, since: formatShortDate(lastMonthEnd) },
      }),
    };
  };
}
