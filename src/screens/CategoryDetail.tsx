import { useMemo, useState } from 'preact/hooks';
import { db, setMeta } from '../db';
import { useMeta, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { useSpending } from '../spendingModel';
import { useRecurringModel } from '../recurringModel';
import { dayOfMonth, daysInMonth, monthKey, monthLabel } from '../lib/dates';
import { formatMoney, parseUserAmount } from '../lib/money';
import { budgetProgress, suggestLimits } from '../lib/budgets';
import { categoryHighlight, categoryMonths, lastMonths, topPlaces } from '../lib/detail';
import { ColumnChart } from '../components/charts';
import { CategoryIcon, Field, Segmented, Sheet } from '../components/ui';
import { Glyph, IconChip } from '../components/icons';
import { categoryLook } from '../components/look';
import { TransactionRow } from '../components/TransactionRow';
import { PlaceDetail } from './PlaceDetail';

const whole = (c: number) => formatMoney(c, { whole: true });

/** Browse pins for a category are stored as "cat:<id>". */
export const categoryPin = (id: string) => `cat:${id}`;

/** The chart color for a category: its hue for built-ins, else the first chart color. */
export function categoryHue(look: ReturnType<typeof categoryLook>) {
  return 'glyph' in look && look.background.startsWith('var(--deep-') ? look.background.replace('--deep-', '--hue-') : 'var(--chart-1)';
}

/** A category up close: its months, budget, the places it goes to, and recent transactions. */
export function CategoryDetail(props: { categoryId: string; month: string; onClose: () => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const rec = useRecurringModel();
  const { months, budgets, cats } = useSpending();
  const cat = cats.get(props.categoryId);
  const budget = budgets.find((b) => b.categoryId === props.categoryId);
  const pins = useMeta<string[]>('browsePins');
  const [range, setRange] = useState<'6' | '12'>('6');
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState('');
  const today = rec.today;
  const current = monthKey(today);
  const [y, m] = current.split('-').map(Number);
  const days = daysInMonth(y, m);
  const day = dayOfMonth(today);
  const suggestion = useMemo(() => suggestLimits(months, current).get(props.categoryId), [months, current, props.categoryId]);

  const keys = lastMonths(current, Number(range));
  const values = useMemo(() => categoryMonths(txns, props.categoryId, keys), [txns, props.categoryId, range, current]);
  const labels = keys.map((k) => monthLabel(k, { short: true }).split(' ')[0]);
  const full = values.slice(0, -1).filter((v) => v > 0);
  const avg = full.length ? Math.round(full.reduce((s, v) => s + v, 0) / full.length) : values[values.length - 1];
  const highlight = cat ? categoryHighlight(cat.name, values, labels, day, days) : null;
  const progress = budget ? budgetProgress([budget], months.get(current), current, today)[0] : undefined;
  const places = useMemo(() => topPlaces(txns, props.categoryId, `${current}-01`, today).slice(0, 5), [txns, props.categoryId, current, today]);
  const recent = useMemo(() => txns.filter((t) => t.categoryId === props.categoryId || t.splits?.some((s) => s.categoryId === props.categoryId)).slice(0, 5), [txns, props.categoryId]);
  const hue = categoryHue(categoryLook(cat));
  const pinned = (pins ?? []).includes(categoryPin(props.categoryId));

  const saveLimit = async () => {
    const cents = parseUserAmount(limit);
    if (cents && cents > 0) await db.budgets.put({ categoryId: props.categoryId, limit: cents, createdAt: budget?.createdAt ?? Date.now() });
    else await db.budgets.delete(props.categoryId);
    setEditing(false);
    nav.toast(cents ? 'Budget saved' : 'Budget removed');
  };
  const togglePin = async () => {
    const list = pins ?? ['networth', 'bills'];
    const id = categoryPin(props.categoryId);
    await setMeta('browsePins', pinned ? list.filter((p) => p !== id) : [...list, id]);
    nav.toast(pinned ? 'Unpinned from Browse' : 'Pinned to Browse');
  };
  const openPlace = (key: string) => nav.present((close) => <PlaceDetail placeKey={key} onClose={close} />);

  return (
    <Sheet title={cat?.name ?? 'Category'} onClose={props.onClose}>
      <div class="detail-title">
        <CategoryIcon category={cat} size="md" />
        <h2>{cat?.name ?? 'Category'}</h2>
        <button type="button" class={`pill ${pinned ? 'primary' : ''}`} aria-pressed={pinned} onClick={togglePin}>
          <Glyph name="pin" /> {pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>

      <Segmented
        value={range}
        options={[
          { value: '6', label: '6 months' },
          { value: '12', label: 'Year' },
        ]}
        onChange={setRange}
      />

      <section class="card lit detail-hero-card" style={{ '--lit': `color-mix(in oklab, ${hue} 14%, transparent)` }}>
        <span class="card-label">Average a month</span>
        <span class="detail-big num">{whole(avg)}</span>
        <span class="card-sub">
          {labels[0]} – {labels[labels.length - 1]} · {whole(values[values.length - 1])} so far this month
        </span>
        <ColumnChart
          title={`${cat?.name ?? 'Category'} spending by month`}
          columns={keys.map((k) => ({ key: k, label: monthLabel(k, { short: true }) }))}
          series={[{ name: 'Spent', color: hue, values }]}
          selected={props.month}
          reference={budget ? { value: budget.limit, label: `Budget ${whole(budget.limit)}` } : undefined}
          onSelect={(k) => nav.showActivity({ categoryId: props.categoryId, month: k })}
        />
      </section>

      {highlight && (
        <section class="card highlight-card">
          <span class="highlight-head">
            <IconChip name="spark" hue="blue" size="sm" />
            <span class="highlight-title">Highlight</span>
          </span>
          <span class="highlight-text">{highlight}</span>
        </section>
      )}

      {cat?.group === 'expense' && (
        <section class="card detail-budget">
          <div class="detail-budget-head">
            <h3>{monthLabel(current).split(' ')[0]} budget</h3>
            {!editing && (
              <button
                type="button"
                class="link strong"
                onClick={() => {
                  setLimit(budget ? String(Math.round(budget.limit / 100)) : suggestion ? String(Math.round(suggestion / 100)) : '');
                  setEditing(true);
                }}
              >
                {budget ? 'Adjust' : 'Set a budget'}
              </button>
            )}
          </div>
          {editing ? (
            <div class="group">
              <Field label="Limit" hint={suggestion ? `Your recent everyday average: ${whole(suggestion)} (rounded up).` : undefined}>
                <input inputMode="decimal" autoFocus placeholder="No budget" value={limit} onInput={(e) => setLimit((e.target as HTMLInputElement).value)} />
              </Field>
              <button type="button" class="row link-row strong" onClick={saveLimit}>
                Save
              </button>
            </div>
          ) : progress ? (
            <>
              <span class="left-bar" aria-hidden="true">
                <span
                  class="left-fill"
                  style={{
                    width: `${Math.min(100, progress.ratio * 100)}%`,
                    background: progress.state === 'ok' ? hue : progress.state === 'warning' ? 'var(--status-warning)' : 'var(--status-critical)',
                  }}
                />
                <span class="left-pace" style={{ left: `${(day / days) * 100}%` }} />
              </span>
              <p class="detail-budget-text">
                <strong class="num">
                  {whole(progress.spent)} of {whole(progress.limit)}
                </strong>{' '}
                · {Math.round(progress.ratio * 100)}% used with {days - day + 1} day{days - day === 0 ? '' : 's'} left. An even pace would be{' '}
                {whole((progress.limit * day) / days)} today.
              </p>
            </>
          ) : (
            <p class="detail-budget-text">No budget yet.{suggestion ? ` Your recent everyday average is ${whole(suggestion)} a month.` : ''}</p>
          )}
        </section>
      )}

      {places.length > 0 && (
        <section class="section">
          <h3 class="section-title">Top places this month</h3>
          <div class="group">
            {places.map((p) => (
              <button type="button" class="row place-row" onClick={() => openPlace(p.key)}>
                <span class="row-main">
                  <span class="place-top">
                    <span class="row-title">
                      {p.name} <span class="muted small">· {p.count} visit{p.count === 1 ? '' : 's'}</span>
                    </span>
                    <span class="num strong">{formatMoney(p.total)}</span>
                  </span>
                  <span class="place-bar">
                    <span style={{ width: `${(p.total / places[0].total) * 100}%`, background: hue }} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section class="section">
          <h3 class="section-title">
            <span>Recent</span>
            <button type="button" class="link" onClick={() => nav.showActivity({ categoryId: props.categoryId })}>
              See all
            </button>
          </h3>
          <div class="group">
            {recent.map((t) => (
              <TransactionRow txn={t} category={cats.get(t.categoryId)} />
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
