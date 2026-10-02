import { useMemo, useState } from 'preact/hooks';
import { CountUp } from '../components/motion';
import { useBook, useTransactions } from '../hooks';
import { changeSince, netWorthOn } from '../lib/networth';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { addMonths, dayInMonth, daysInMonth, dayOfMonth, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { budgetProgress, monthElapsed } from '../lib/budgets';
import { countsAsCost } from '../lib/recurring';
import { Money, Section } from '../components/ui';
import { ColumnChart, RankedBars, compactMoney } from '../components/charts';
import { BudgetMeter, budgetStatusText } from '../components/BudgetMeter';
import { SummaryCard } from '../components/SummaryCard';
import { BudgetsEditor } from './BudgetsEditor';
import { CategoryDetail } from './CategoryDetail';

/** Stat-tile values auto-compact so they fit a third of the screen: $2,271 but $17.4K. */
const tile = (cents: number) => (Math.abs(cents) >= 1_000_000 ? compactMoney(cents) : formatMoney(cents, { whole: true }));

/** Month by month: budgets, what you spent and where, and the trend charts (Browse → Spending). */
export function Spending() {
  const nav = useNav();
  const txns = useTransactions();
  const rec = useRecurringModel();
  const { months, budgets, cats } = useSpending();
  const today = rec.today;
  const current = monthKey(today);
  const [month, setMonth] = useState(current);
  const isCurrent = month === current;
  const book = useBook();
  const netWorth = useMemo(() => netWorthOn(book).net, [book]);
  const lastMonthEnd = dayInMonth(`${addMonths(current, -1)}-01`, 0, 31);
  const nwChange = useMemo(() => changeSince(book, lastMonthEnd).total, [book, lastMonthEnd]);
  const m = months.get(month);
  const spent = (m?.flexible ?? 0) + (m?.fixed ?? 0);
  const progress = useMemo(() => budgetProgress(budgets, m, month, today), [budgets, m, month, today]);
  const elapsed = monthElapsed(month, today);
  const budgetTotal = progress.reduce((s, p) => s + p.limit, 0);
  const budgetSpent = progress.reduce((s, p) => s + p.spent, 0);
  const budgeted = new Set(budgets.map((b) => b.categoryId));
  const otherFlexible = [...(m?.byCategory ?? [])].filter(([id]) => !budgeted.has(id)).reduce((s, [, v]) => s + Math.max(0, v), 0);
  const warnings = isCurrent ? progress.filter((p) => p.state !== 'ok' || p.offPace) : [];
  // Card payments aren't bills: the purchases they pay for are already counted as spending.
  const stillDue = isCurrent ? rec.upcomingItems.filter((i) => countsAsCost(i.status.rec) && monthKey(i.date) === month).reduce((s, i) => s + Math.abs(i.amount), 0) : 0;
  const [y, mo] = month.split('-').map(Number);
  const daysLeft = isCurrent ? daysInMonth(y, mo) - dayOfMonth(today) + 1 : 0;
  const editBudgets = () => nav.present((close) => <BudgetsEditor onClose={close} />);
  const openCategory = (id: string) => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />);

  // Charts: 12 months of spending; 6 months of income vs spending ending at the viewed month.
  const trendKeys = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 11));
  const flowKeys = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const total = (k: string) => Math.max(0, (months.get(k)?.flexible ?? 0) + (months.get(k)?.fixed ?? 0));
  const income = (k: string) => Math.max(0, months.get(k)?.income ?? 0);
  const where = [...(m?.allByCategory ?? [])]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <>
      <header class="large-title">
        <h1>Spending</h1>
      </header>
      <div class="month-switch" role="group" aria-label="Month">
        <button type="button" class="icon-button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" class="icon-button" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </button>
      </div>

      {budgets.length > 0 ? (
        <button type="button" class="hero-card" onClick={editBudgets}>
          <span class="card-label">{budgetSpent > budgetTotal ? 'Over budget' : isCurrent ? 'Left to spend' : 'Left in budget'}</span>
          <span class={`hero-number ${budgetSpent > budgetTotal ? 'neg-text' : ''}`}>{formatMoney(Math.abs(budgetTotal - budgetSpent), { whole: true })}</span>
          <span class="card-sub">
            {formatMoney(budgetSpent, { whole: true })} of {formatMoney(budgetTotal, { whole: true })} budgeted
            {isCurrent && ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
          </span>
        </button>
      ) : (
        <div class="hero-card">
          <span class="card-label">Spent in {monthLabel(month, { short: true }).split(' ')[0]}</span>
          <span class="hero-number">{formatMoney(spent, { whole: true })}</span>
          <span class="card-sub">
            {formatMoney(total(addMonths(month, -1)), { whole: true })} the month before
          </span>
        </div>
      )}

      <div class="kpis">
        <button type="button" class="kpi" onClick={() => nav.showActivity({ month })}>
          <span class="card-label">Spent</span>
          <CountUp class="kpi-value" value={spent} format={tile} />
          <span class="card-sub">{formatMoney(m?.flexible ?? 0, { whole: true })} everyday</span>
        </button>
        <button type="button" class="kpi" onClick={() => nav.setTab('recurring')}>
          <span class="card-label">Fixed bills</span>
          <CountUp class="kpi-value" value={(m?.fixed ?? 0) + stillDue} format={tile} />
          <span class="card-sub">{isCurrent ? `${formatMoney(stillDue, { whole: true })} still due` : 'paid'}</span>
        </button>
        <button type="button" class="kpi" onClick={() => nav.setTab('accounts')}>
          <span class="card-label">Net worth</span>
          <CountUp class="kpi-value" value={netWorth} format={tile} />
          <span class="card-sub">
            {nwChange >= 0 ? '▲' : '▼'} {tile(Math.abs(nwChange))} this month
          </span>
        </button>
      </div>

      {txns.length > 0 && <SummaryCard month={month} />}

      {warnings.length > 0 && (
        <div class="callout warn">
          <strong>
            {warnings.length} budget{warnings.length === 1 ? ' needs' : 's need'} attention
          </strong>
          {warnings.map((p) => {
            const s = budgetStatusText(p);
            return (
              <p>
                <span aria-hidden="true">{s.icon} </span>
                {cats.get(p.categoryId)?.name}: {s.text}
              </p>
            );
          })}
        </div>
      )}

      {budgets.length > 0 ? (
        <Section
          title={
            <>
              <span>Budgets</span>
              <button type="button" class="link" onClick={editBudgets}>
                Edit
              </button>
            </>
          }
          footer={isCurrent ? 'The line on each bar shows where you’d be at an even pace for the month.' : undefined}
        >
          {progress
            .sort((a, b) => b.ratio - a.ratio)
            .map((p) => (
              <BudgetMeter progress={p} category={cats.get(p.categoryId)} elapsed={isCurrent ? elapsed : 0} onClick={() => openCategory(p.categoryId)} />
            ))}
          {otherFlexible > 0 && (
            <div class="row">
              <span class="row-main">
                <span class="row-title">Everything else</span>
                <span class="row-subtitle">Categories without a budget</span>
              </span>
              <span class="row-detail">{formatMoney(otherFlexible, { whole: true })}</span>
            </div>
          )}
        </Section>
      ) : (
        txns.length > 0 && (
          <button type="button" class="callout" onClick={editBudgets}>
            <strong>Set up monthly budgets</strong>
            <p>Limits are suggested from your last 3 months of everyday spending, and you can adjust any of them.</p>
          </button>
        )
      )}

      {txns.length > 0 && (
        <>
          <Section title="Spending by month">
            <ColumnChart
              title="Total spending for the last 12 months"
              columns={trendKeys.map((k) => ({ key: k, label: monthLabel(k, { short: true }) }))}
              series={[{ name: 'Spent', color: 'var(--chart-1)', values: trendKeys.map(total) }]}
              selected={month}
              onSelect={setMonth}
            />
          </Section>

          <Section title="Income vs spending">
            <ColumnChart
              title="Income and spending for the last 6 months"
              columns={flowKeys.map((k) => ({ key: k, label: monthLabel(k, { short: true }) }))}
              series={[
                { name: 'Income', color: 'var(--chart-1)', values: flowKeys.map(income) },
                { name: 'Spending', color: 'var(--chart-2)', values: flowKeys.map(total) },
              ]}
              selected={month}
              onSelect={setMonth}
              readoutExtra={(i) => {
                const net = income(flowKeys[i]) - total(flowKeys[i]);
                return (
                  <span class="readout-item muted">
                    {net >= 0 ? 'saved' : 'overspent'} <Money cents={Math.abs(net)} whole />
                  </span>
                );
              }}
            />
          </Section>

          <Section title={`Where it went · ${monthLabel(month, { short: true })}`} footer="Includes bills and subscriptions. Tap a category for its history.">
            {where.length ? (
              <RankedBars
                items={where.map(([id, v]) => ({
                  key: id,
                  label: (
                    <>
                      <span aria-hidden="true">{cats.get(id)?.emoji}</span> {cats.get(id)?.name ?? 'Unknown'}
                    </>
                  ),
                  value: v,
                }))}
                onSelect={openCategory}
              />
            ) : (
              <div class="group">
                <div class="row muted">No spending this month.</div>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
