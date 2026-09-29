import { useMemo, useState } from 'preact/hooks';
import { useAccounts, useBook, useMeta, useTransactions } from '../hooks';
import { changeSince, netWorthOn, staleValued } from '../lib/networth';
import { UpdateValues } from './UpdateValues';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { addDays, addMonths, dayInMonth, daysInMonth, dayOfMonth, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { budgetProgress, monthElapsed } from '../lib/budgets';
import { countsAsCost } from '../lib/recurring';
import { Empty, Money, Section } from '../components/ui';
import { ColumnChart, RankedBars, compactMoney } from '../components/charts';

/** Stat-tile values auto-compact so they fit a third of the screen: $2,271 but $17.4K. */
const tile = (cents: number) => (Math.abs(cents) >= 1_000_000 ? compactMoney(cents) : formatMoney(cents, { whole: true }));
import { BudgetMeter, budgetStatusText } from '../components/BudgetMeter';
import { RecurringRow } from '../components/RecurringRow';
import { Icons } from '../components/icons';
import { AccountEditor } from './AccountEditor';
import { ImportFlow } from './Import';
import { AlertCard } from './Recurring';
import { RecurringReview } from './RecurringReview';
import { BudgetsEditor } from './BudgetsEditor';
import { CategoryDetail } from './CategoryDetail';
import { AskSheet } from './AskSheet';
import { Plan } from './plan/Plan';
import { SuggestCategories } from './SuggestCategories';
import { ReviewAiPicks } from './ReviewAiPicks';
import { TidyUp, useOldGuesses } from './TidyUp';
import { OwedSheet } from './Owed';
import { owedByPerson, owedItems } from '../lib/lines';
import { SummaryCard } from '../components/SummaryCard';
import { useAi } from '../ai/client';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function Home() {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const lastBackup = useMeta<number>('lastBackupAt');
  const rec = useRecurringModel();
  const ai = useAi();
  const { months, budgets, cats } = useSpending();
  const today = rec.today;
  const current = monthKey(today);
  const [month, setMonth] = useState(current);
  const isCurrent = month === current;

  const open = accounts.filter((a) => !a.archived);
  const book = useBook();
  const netWorth = useMemo(() => netWorthOn(book).net, [book]);
  const lastMonthEnd = dayInMonth(`${addMonths(current, -1)}-01`, 0, 31);
  const nwChange = useMemo(() => changeSince(book, lastMonthEnd).total, [book, lastMonthEnd]);
  const stale = staleValued(book, today);
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
  const soon = isCurrent ? rec.upcomingItems.filter((i) => i.late || i.date <= addDays(today, rec.settings.reminderDays)) : [];
  const uncategorized = txns.filter((t) => t.categoryId === 'uncategorized').length;
  const aiPicks = txns.filter((t) => t.categorySource === 'ai').length;
  // One-time nudge to review old guessed categories (also always in Settings → Organize).
  const oldGuesses = useOldGuesses()?.length ?? 0;
  const tidyDone = useMeta<number>('tidyUpDone');
  const owed = useMemo(() => owedByPerson(owedItems(txns)), [txns]);
  const owedTotal = owed.reduce((sum, p) => sum + p.total, 0);
  const backupDue = txns.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 86_400_000);
  const [y, mo] = month.split('-').map(Number);
  const daysLeft = isCurrent ? daysInMonth(y, mo) - dayOfMonth(today) + 1 : 0;

  // Charts: 12 months of spending; 6 months of income vs spending ending at the viewed month.
  const trendKeys = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 11));
  const flowKeys = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
  const total = (k: string) => Math.max(0, (months.get(k)?.flexible ?? 0) + (months.get(k)?.fixed ?? 0));
  const income = (k: string) => Math.max(0, months.get(k)?.income ?? 0);
  const where = [...(m?.allByCategory ?? [])]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const addAccount = () => nav.present((close) => <AccountEditor onClose={close} />);
  const importFile = () => nav.present((close) => <ImportFlow onClose={close} />);
  const editBudgets = () => nav.present((close) => <BudgetsEditor onClose={close} />);
  const openCategory = (id: string) => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />);

  return (
    <>
      <header class="large-title">
        <h1>Overview</h1>
        {open.length > 0 && (
          <div class="header-actions">
            <button type="button" class="icon-button" aria-label="Ask a question" onClick={() => nav.present((close) => <AskSheet onClose={close} />)}>
              {Icons.sparkle()}
            </button>
            <button type="button" class="icon-button" aria-label="Plan: financial calculators" onClick={() => nav.present((close) => <Plan onClose={close} />)}>
              {Icons.calculator()}
            </button>
            <button type="button" class="icon-button" aria-label="Import a file" onClick={importFile}>
              {Icons.import()}
            </button>
          </div>
        )}
      </header>

      {!isStandalone() && (
        <div class="callout">
          <strong>Install on your iPhone</strong>
          <p>
            In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It will open full-screen and work offline, and your data
            stays on this phone.
          </p>
        </div>
      )}

      {open.length === 0 ? (
        <Empty icon="👋" title="Welcome">
          <p>
            Everything you enter stays on this device. Nothing is sent anywhere. Start by adding an account, or import a file you
            downloaded from your bank.
          </p>
          <div class="button-stack">
            <button type="button" class="button primary" onClick={importFile}>
              Import a Bank File
            </button>
            <button type="button" class="button" onClick={addAccount}>
              Add an Account Manually
            </button>
          </div>
        </Empty>
      ) : (
        <>
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
              <span class="kpi-value">{tile(spent)}</span>
              <span class="card-sub">{formatMoney(m?.flexible ?? 0, { whole: true })} everyday</span>
            </button>
            <button type="button" class="kpi" onClick={() => nav.setTab('recurring')}>
              <span class="card-label">Fixed bills</span>
              <span class="kpi-value">{tile((m?.fixed ?? 0) + stillDue)}</span>
              <span class="card-sub">{isCurrent ? `${formatMoney(stillDue, { whole: true })} still due` : 'paid'}</span>
            </button>
            <button type="button" class="kpi" onClick={() => nav.setTab('accounts')}>
              <span class="card-label">Net worth</span>
              <span class="kpi-value">{tile(netWorth)}</span>
              <span class="card-sub">
                {nwChange >= 0 ? '▲' : '▼'} {tile(Math.abs(nwChange))} this month
              </span>
            </button>
          </div>

          {txns.length > 0 && <SummaryCard month={month} />}

          {isCurrent && rec.alerts.map((a) => <AlertCard key={a.key} alert={a} />)}

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

          {soon.length > 0 && (
            <Section
              title={
                <>
                  <span>Upcoming bills</span>
                  <button type="button" class="link" onClick={() => nav.setTab('recurring')}>
                    See all
                  </button>
                </>
              }
            >
              {soon.map((i) => (
                <RecurringRow status={i.status} today={today} date={i.date} late={i.late} category={cats.get(i.status.rec.categoryId ?? '')} />
              ))}
            </Section>
          )}

          {isCurrent && stale.length > 0 && (
            <button type="button" class="callout" onClick={() => nav.present((close) => <UpdateValues onClose={close} />)}>
              <strong>Time to update {stale.length === 1 ? stale[0].name : 'investment & vehicle values'}</strong>
              <p>It's been over a month (or they were never set). Keeps your net worth history accurate.</p>
            </button>
          )}

          {rec.suggestions.length > 0 && rec.recurring.length === 0 && (
            <button type="button" class="callout" onClick={() => nav.present((close) => <RecurringReview onClose={close} />)}>
              <strong>Found {rec.suggestions.length} possible subscriptions &amp; bills</strong>
              <p>Tap to review them. Confirmed ones show up here before they're due.</p>
            </button>
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

          {owed.length > 0 && (
            <button type="button" class="callout" onClick={() => nav.present((close) => <OwedSheet onClose={close} />)}>
              <strong>🤝 {formatMoney(owedTotal)} owed to you</strong>
              <p>
                {owed
                  .slice(0, 3)
                  .map((p) => `${p.who} ${formatMoney(p.total)}`)
                  .join(' · ')}
                {owed.length > 3 ? ` · +${owed.length - 3} more` : ''}. Tap when you’re paid back.
              </p>
            </button>
          )}

          {oldGuesses > 0 && !tidyDone && (
            <button type="button" class="callout" onClick={() => nav.present((close) => <TidyUp onClose={close} />)}>
              <strong>
                🧹 Tidy up {oldGuesses} guessed categor{oldGuesses === 1 ? 'y' : 'ies'}
              </strong>
              <p>Older transactions filed as “Other”, unknown money-in as Income, or not at all. A quick review makes your charts and budgets right.</p>
            </button>
          )}

          {aiPicks > 0 && (
            <button type="button" class="callout" onClick={() => nav.present((close) => <ReviewAiPicks onClose={close} />)}>
              <strong>
                ✨ {aiPicks} AI-categorized transaction{aiPicks === 1 ? '' : 's'} to check
              </strong>
              <p>The on-device AI filed these at import. A quick look confirms them, and any fixes teach it.</p>
            </button>
          )}

          {uncategorized > 0 && (
            <div class="callout">
              <button type="button" class="callout-body" onClick={() => nav.showActivity({ categoryId: 'uncategorized' })}>
                <strong>
                  {uncategorized} transaction{uncategorized === 1 ? '' : 's'} to categorize
                </strong>
                <p>Tap to review. When you pick a category, the app offers to remember it for next time.</p>
              </button>
              {ai.embed && (
                <button type="button" class="pill" onClick={() => nav.present((close) => <SuggestCategories onClose={close} />)}>
                  ✨ Suggest categories
                </button>
              )}
            </div>
          )}

          {backupDue && (
            <button type="button" class="callout warn" onClick={() => nav.setTab('settings')}>
              <strong>Back up your data</strong>
              <p>{lastBackup ? "It's been over two weeks since your last backup." : "You haven't made a backup yet."} Your data only lives on this phone. Tap to save a backup file.</p>
            </button>
          )}
        </>
      )}
    </>
  );
}
