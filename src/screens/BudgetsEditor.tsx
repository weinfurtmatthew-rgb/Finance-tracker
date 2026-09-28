import { useMemo, useState } from 'preact/hooks';
import { db } from '../db';
import { useNav } from '../nav';
import { useSpending } from '../spendingModel';
import { monthKey, todayISO } from '../lib/dates';
import { formatMoney, parseUserAmount } from '../lib/money';
import { suggestLimits } from '../lib/budgets';
import { Section, Sheet } from '../components/ui';

export function BudgetsEditor(props: { onClose: () => void }) {
  const nav = useNav();
  const { months, budgets, budgetsLoaded, categories } = useSpending();
  const suggestions = useMemo(() => suggestLimits(months, monthKey(todayISO())), [months]);
  if (!budgetsLoaded) return null;
  return <Form {...props} nav={nav} budgets={budgets} categories={categories} suggestions={suggestions} />;
}

function Form(props: {
  onClose: () => void;
  nav: ReturnType<typeof useNav>;
  budgets: { categoryId: string; limit: number; createdAt: number }[];
  categories: ReturnType<typeof useSpending>['categories'];
  suggestions: Map<string, number>;
}) {
  const expense = props.categories.filter((c) => c.group === 'expense');
  const first = props.budgets.length === 0;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of expense) {
      const existing = props.budgets.find((b) => b.categoryId === c.id);
      const cents = existing?.limit ?? (first ? props.suggestions.get(c.id) : undefined);
      init[c.id] = cents ? String(Math.round(cents / 100)) : '';
    }
    return init;
  });
  // Categories with a budget or a suggestion first, then the rest.
  const ordered = [...expense].sort((a, b) => Number(!values[a.id]) - Number(!values[b.id]) || a.order - b.order);
  const total = Object.values(values).reduce((s, v) => s + (parseUserAmount(v) ?? 0), 0);

  const save = async () => {
    const now = Date.now();
    await db.transaction('rw', db.budgets, async () => {
      for (const c of expense) {
        const cents = parseUserAmount(values[c.id] ?? '');
        if (cents && cents > 0) {
          const existing = props.budgets.find((b) => b.categoryId === c.id);
          await db.budgets.put({ categoryId: c.id, limit: cents, createdAt: existing?.createdAt ?? now });
        } else {
          await db.budgets.delete(c.id);
        }
      }
    });
    props.nav.toast('Budgets saved');
    props.onClose();
  };

  return (
    <Sheet title="Monthly Budgets" onClose={props.onClose} onSave={save}>
      <p class="section-footer intro">
        {first && props.suggestions.size
          ? 'Pre-filled with your average everyday spending over the last 3 months, rounded up. Adjust any amount, or clear it for no budget.'
          : 'A monthly limit for each category. Leave blank for no budget.'}{' '}
        Bills and subscriptions you track under Recurring are counted separately, so budgets are just for everyday spending.
      </p>
      <Section title={`Total ${formatMoney(total, { whole: true })} / month`}>
        {ordered.map((c) => (
          <label class="field">
            <span class="field-label">
              <span aria-hidden="true">{c.emoji}</span> {c.name}
            </span>
            <span class="field-control">
              <input
                inputMode="decimal"
                placeholder={props.suggestions.get(c.id) ? `avg ${formatMoney(props.suggestions.get(c.id)!, { whole: true })}` : 'No budget'}
                value={values[c.id]}
                onInput={(e) => setValues({ ...values, [c.id]: (e.target as HTMLInputElement).value })}
              />
            </span>
          </label>
        ))}
      </Section>
      {!first && props.suggestions.size > 0 && (
        <Section>
          <button
            type="button"
            class="row link-row"
            onClick={() => {
              const next = { ...values };
              for (const [id, cents] of props.suggestions) next[id] = String(Math.round(cents / 100));
              setValues(next);
            }}
          >
            Fill In Suggestions from Last 3 Months
          </button>
        </Section>
      )}
    </Sheet>
  );
}
