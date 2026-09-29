import { useMemo, useRef, useState } from 'preact/hooks';
import { allTags } from '../lib/lines';
import { people } from '../lib/p2p';
import { usePlanData } from '../planModel';
import { byId, useBook, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { addMonths, dayInMonth, formatShortDate, monthKey } from '../lib/dates';
import { budgetProgress } from '../lib/budgets';
import { changeSince, netWorthOn } from '../lib/networth';
import { formatMoney } from '../lib/money';
import { EXAMPLES, answer, understand, type Answer } from '../ai/ask';
import { useAi } from '../ai/client';
import { vectors } from '../ai/vectors';
import { CATEGORY_SEEDS } from '../ai/similar';
import { Sheet } from '../components/ui';

interface Turn {
  question: string;
  answer?: Answer;
  error?: string;
  pending?: boolean;
}

export function AskSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const ai = useAi();
  const txns = useTransactions();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const rec = useRecurringModel();
  const { months, budgets } = useSpending();
  const book = useBook();
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const today = rec.today;
  const merchants = useMemo(() => [...new Set(txns.map((t) => t.payee).filter(Boolean))], [txns]);
  const tags = useMemo(() => allTags(txns).map((x) => x.tag), [txns]);
  const plan = usePlanData();
  const peopleNames = useMemo(() => [...people(txns).map((p) => p.name)], [txns]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    setText('');
    const index = turns.length;
    setTurns((t) => [...t, { question: q, pending: true }]);
    const ctx = { today, categories, merchants, tags, people: peopleNames };
    let query = null;
    try {
      query = await understand(q, ctx, ai.embed ? vectors : undefined, CATEGORY_SEEDS);
    } catch {
      query = null;
    }
    let turn: Turn;
    if (!query) {
      turn = {
        question: q,
        error: ai.embed
          ? "Sorry, I couldn't work out what to look up. Try asking about spending, a category, a store, income, subscriptions, budgets or net worth."
          : "I couldn't understand that with the basic parser. Try one of the examples, or turn on on-device AI in Settings for more flexible questions.",
      };
    } else {
      const lastMonthEnd = dayInMonth(`${addMonths(monthKey(today), -1)}-01`, 0, 31);
      turn = {
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
    }
    setTurns((t) => t.map((x, i) => (i === index ? turn : x)));
    requestAnimationFrame(() => listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <Sheet title="Ask" onClose={props.onClose}>
      <div class="ask" ref={listRef}>
        {turns.length === 0 && (
          <div class="ask-intro">
            <p class="muted">
              Ask about your spending, income, subscriptions, budgets or net worth. Answers are calculated exactly from your data, on this phone.
              {ai.embed ? ' The on-device AI helps understand questions phrased in your own words.' : ''}
            </p>
            <div class="ask-examples">
              {EXAMPLES.map((e) => (
                <button type="button" class="pill" onClick={() => ask(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div class="ask-turn">
            <p class="ask-q">{t.question}</p>
            {t.pending && <p class="ask-a muted">Thinking…</p>}
            {t.error && <p class="ask-a">{t.error}</p>}
            {t.answer && (
              <div class="ask-a">
                <strong class="ask-headline">{t.answer.headline}</strong>
                {t.answer.detail && <p class="muted">{t.answer.detail}</p>}
                {t.answer.items && (
                  <ul class="ask-items">
                    {t.answer.items.map((i) => (
                      <li>
                        <span>
                          {i.label}
                          {i.note && <span class="muted"> · {i.note}</span>}
                        </span>
                        <span class="money">{formatMoney(i.value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p class="ask-meta">
                  Understood as: {t.answer.interpretation}
                  {t.answer.filter && (t.answer.filter.categoryId || t.answer.filter.month || t.answer.filter.tag) && (
                    <>
                      {' · '}
                      <button type="button" class="link" onClick={() => nav.showActivity(t.answer!.filter!)}>
                        See transactions
                      </button>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        class="ask-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <input type="text" enterKeyHint="send" placeholder="Ask a question…" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label="Question" />
        <button type="submit" class="pill primary" disabled={!text.trim()}>
          Ask
        </button>
      </form>
    </Sheet>
  );
}
