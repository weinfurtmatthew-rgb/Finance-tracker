import { useMemo, useState } from 'preact/hooks';
import { db } from '../db';
import { useNav } from '../nav';
import { useSpending } from '../spendingModel';
import { addMonths, monthKey, monthLabel, todayISO } from '../lib/dates';
import { formatMoney, parseUserAmount } from '../lib/money';
import { suggestLimits } from '../lib/budgets';
import { ColumnChart } from '../components/charts';
import { Field, Row, Section, Sheet } from '../components/ui';

export function CategoryDetail(props: { categoryId: string; month: string; onClose: () => void }) {
  const nav = useNav();
  const { months, budgets, cats } = useSpending();
  const cat = cats.get(props.categoryId);
  const budget = budgets.find((b) => b.categoryId === props.categoryId);
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState('');
  const current = monthKey(todayISO());
  const suggestion = useMemo(() => suggestLimits(months, current).get(props.categoryId), [months, current, props.categoryId]);

  const keys = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 11));
  const all = keys.map((k) => Math.max(0, months.get(k)?.allByCategory.get(props.categoryId) ?? 0));
  const flexible = keys.map((k) => Math.max(0, months.get(k)?.byCategory.get(props.categoryId) ?? 0));
  const hasFixed = all.some((v, i) => v !== flexible[i]);
  const last3 = all.slice(-4, -1);
  const avg = Math.round(last3.reduce((s, v) => s + v, 0) / 3);
  const year = all.reduce((s, v) => s + v, 0);

  const saveLimit = async () => {
    const cents = parseUserAmount(limit);
    if (cents && cents > 0) await db.budgets.put({ categoryId: props.categoryId, limit: cents, createdAt: budget?.createdAt ?? Date.now() });
    else await db.budgets.delete(props.categoryId);
    setEditing(false);
    nav.toast(cents ? 'Budget saved' : 'Budget removed');
  };

  return (
    <Sheet title={cat ? `${cat.emoji} ${cat.name}` : 'Category'} onClose={props.onClose}>
      <Section title="Last 12 months">
        <ColumnChart
          title={`${cat?.name ?? 'Category'} spending by month`}
          columns={keys.map((k) => ({ key: k, label: monthLabel(k, { short: true }) }))}
          series={[{ name: 'Spent', color: 'var(--chart-1)', values: all }]}
          selected={props.month}
          reference={budget ? { value: budget.limit, label: `Budget ${formatMoney(budget.limit, { whole: true })}` } : undefined}
          onSelect={(k) => nav.showActivity({ categoryId: props.categoryId, month: k })}
        />
      </Section>
      <Section footer={hasFixed ? 'Includes tracked bills & subscriptions. Budgets only count everyday spending in this category.' : undefined}>
        <Row title={monthLabel(props.month)} detail={formatMoney(months.get(props.month)?.allByCategory.get(props.categoryId) ?? 0)} chevron={false} />
        <Row title="3-month average" detail={formatMoney(avg)} chevron={false} />
        <Row title="Last 12 months" detail={formatMoney(year)} chevron={false} />
      </Section>
      {cat?.group === 'expense' && (
        <Section title="Monthly budget" footer={suggestion ? `Your recent everyday average: ${formatMoney(suggestion, { whole: true })} (rounded up).` : undefined}>
          {editing ? (
            <>
              <Field label="Limit">
                <input inputMode="decimal" autoFocus placeholder="No budget" value={limit} onInput={(e) => setLimit((e.target as HTMLInputElement).value)} />
              </Field>
              <button type="button" class="row link-row strong" onClick={saveLimit}>
                Save
              </button>
            </>
          ) : (
            <Row
              title={budget ? formatMoney(budget.limit, { whole: true }) + ' / month' : 'No budget'}
              detail="Edit"
              onClick={() => {
                setLimit(budget ? String(Math.round(budget.limit / 100)) : suggestion ? String(Math.round(suggestion / 100)) : '');
                setEditing(true);
              }}
            />
          )}
        </Section>
      )}
      <Section>
        <button type="button" class="row link-row" onClick={() => nav.showActivity({ categoryId: props.categoryId, month: props.month })}>
          View {monthLabel(props.month, { short: true })} Transactions
        </button>
      </Section>
    </Sheet>
  );
}
