import { useEffect, useMemo, useState } from 'preact/hooks';
import { CountUp } from '../components/motion';
import { useAccounts, useBook, useMeta, useTransactions } from '../hooks';
import { staleValued } from '../lib/networth';
import { UpdateValues } from './UpdateValues';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { usePlanData } from '../planModel';
import { addDays, addMonths, daysInMonth, diffDays, formatLongDay, formatShortDate, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { budgetProgress, heldEveryBudget } from '../lib/budgets';
import { accountBalance } from '../lib/balances';
import { isOutflow } from '../lib/recurring';
import { billsShown, isBillCategory } from '../lib/spend';
import { categoryChanges, pace, paceTarget, spendReadiness, todayFacts, todaySummary, type Phrase } from '../lib/today';
import { Empty, Section } from '../components/ui';
import { Glyph, IconChip, Icons, type GlyphName, type Hue } from '../components/icons';
import { TransactionRow } from '../components/TransactionRow';
import { Gauge, verdictColor } from '../components/Gauge';
import { PaceChart } from '../components/PaceChart';
import { ProfileButton } from '../components/ProfileButton';
import { RecurringRow } from '../components/RecurringRow';
import { AccountEditor } from './AccountEditor';
import { ImportFlow } from '../lazy';
import { BackupSheet } from './Backup';
import { BACKUP_SNOOZE_DAYS, backupDue, DEFAULT_BACKUP_EVERY_DAYS } from '../lib/backup';
import { AlertCard } from './Recurring';
import { RecurringReview } from './RecurringReview';
import { BudgetsEditor } from './BudgetsEditor';
import { CategoryDetail } from './CategoryDetail';
import { ReadinessSheet } from './Readiness';
import { SuggestCategories } from './SuggestCategories';
import { ReviewAiPicks } from './ReviewAiPicks';
import { TidyUp, useOldGuesses } from './TidyUp';
import { OwedSheet } from './Owed';
import { usePaymentAppNudges, WhatWasThis } from './People';
import { DuplicatesSheet, useImportCopies } from './Duplicates';
import { RecapStories } from './Recap';
import { RunwayCalc } from './plan/Runway';
import { autoRecapYear, yearPeriod } from '../lib/recap';
import { db, setMeta } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { owedByPerson, owedItems } from '../lib/lines';
import { useAi } from '../ai/client';

/** The automatic year in review is only considered once per app launch. */
let recapCheckedThisLaunch = false;

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const whole = (c: number) => formatMoney(c, { whole: true });

/** "Friday" within the week, else "Oct 24". */
const dayName = (date: string, today: string) => {
  if (diffDays(today, date) < 7) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
  }
  return formatShortDate(date);
};

function Sentence(props: { phrases: Phrase[] }) {
  return <>{props.phrases.map((p) => (p.tone ? <span class={p.tone === 'good' ? 'pos-text' : 'neg-text'}>{p.text}</span> : p.text))} </>;
}

/** Something on the To do list: one line, tap to deal with it. */
interface Todo {
  key: string;
  glyph: GlyphName;
  hue: Hue;
  title: string;
  sub: string;
  /** What tapping does (nothing for a plain tip). */
  open?: () => void;
  /** Snooze it for a while. */
  later?: () => void;
}

/** Shows the first few; the rest are a tap away. */
function TodoList(props: { items: Todo[] }) {
  const [all, setAll] = useState(false);
  if (!props.items.length) return null;
  const shown = all ? props.items : props.items.slice(0, TODO_SHOWN);
  const hidden = props.items.length - shown.length;
  return (
    <Section title="To do">
      {shown.map((t) => (
        <div class="row todo-row" key={t.key}>
          {t.open ? (
            <button type="button" class="todo-main" onClick={t.open}>
              <IconChip name={t.glyph} hue={t.hue} size="sm" />
              <span class="row-main">
                <span class="row-title">{t.title}</span>
                <span class="row-subtitle">{t.sub}</span>
              </span>
              {!t.later && (
                <span class="chevron" aria-hidden="true">
                  ›
                </span>
              )}
            </button>
          ) : (
            <span class="todo-main">
              <IconChip name={t.glyph} hue={t.hue} size="sm" />
              <span class="row-main">
                <span class="row-title">{t.title}</span>
                <span class="row-subtitle wrap">{t.sub}</span>
              </span>
            </span>
          )}
          {t.later && (
            <button type="button" class="pill todo-later" onClick={t.later} aria-label={`Later: ${t.title}`}>
              Later
            </button>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" class="row todo-more" onClick={() => setAll(true)}>
          <span class="row-title link">{hidden} more</span>
        </button>
      )}
    </Section>
  );
}

const TODO_SHOWN = 3;

/** Today: how the day and month look, what to watch, and what's coming up. */
export function Home() {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const lastBackup = useMeta<number>('lastBackupAt');
  const rec = useRecurringModel();
  const ai = useAi();
  const plan = usePlanData();
  const { months, budgets, cats } = useSpending();
  const today = rec.today;
  const month = monthKey(today);
  const monthName = monthLabel(month).split(' ')[0];
  const monthShort = monthLabel(month, { short: true }).split(' ')[0];

  const open = accounts.filter((a) => !a.archived);
  const book = useBook();
  const stale = staleValued(book, today);
  const uncategorized = txns.filter((t) => t.categoryId === 'uncategorized').length;
  const aiPicks = txns.filter((t) => t.categorySource === 'ai').length;
  // One-time nudge to review old guessed categories (also always in Settings → Categories & Rules).
  const oldGuesses = useOldGuesses()?.length ?? 0;
  const tidyDone = useMeta<number>('tidyUpDone');
  const owed = useMemo(() => owedByPerson(owedItems(txns)), [txns]);
  const appNudges = usePaymentAppNudges();
  const copies = useImportCopies();
  // The year in review opens by itself once: in December (this year) or early January (last year),
  // when the app starts (never in the middle of something, like an import).
  const recapYear = autoRecapYear(today);
  // A new month: if every budget held last month, a small celebration (once).
  const celebratedMonth = useLiveQuery(async () => ((await db.meta.get('celebratedMonth'))?.value as string | undefined) ?? '', []);
  useEffect(() => {
    const prev = addMonths(month, -1);
    const spent = months.get(prev);
    if (celebratedMonth === undefined || celebratedMonth === prev || !spent || !budgets.length) return;
    const [y, m] = prev.split('-').map(Number);
    const progress = budgetProgress(budgets, spent, prev, `${prev}-${String(daysInMonth(y, m)).padStart(2, '0')}`);
    if (!heldEveryBudget(budgets, progress, new Date(`${prev}-01T00:00:00`).getTime())) return;
    void setMeta('celebratedMonth', prev);
    nav.celebrate(`${monthLabel(prev).split(' ')[0]}: under budget`, 'Every category stayed within its limit.');
  }, [celebratedMonth, months, budgets, month]);
  const recapCheck = useLiveQuery(async () => {
    if (recapYear == null) return null;
    const shown = (await db.meta.get('recapShownFor'))?.value;
    const count = await db.transactions.where('date').between(`${recapYear}-01-01`, `${recapYear}-12-31`, true, true).count();
    return { due: shown !== recapYear && count >= 30 };
  }, [recapYear]);
  useEffect(() => {
    if (recapCheck === undefined || recapCheckedThisLaunch) return;
    recapCheckedThisLaunch = true;
    if (!recapCheck?.due) return;
    void setMeta('recapShownFor', recapYear);
    nav.present((close) => <RecapStories period={yearPeriod(recapYear!, today)} onClose={close} />);
  }, [recapCheck]);
  const owedTotal = owed.reduce((sum, p) => sum + p.total, 0);
  const backupEvery = useMeta<number>('backupEveryDays') ?? DEFAULT_BACKUP_EVERY_DAYS;
  const backupSnooze = useMeta<number>('backupSnoozeUntil');
  const showBackup = backupDue({ hasData: txns.length > 0, lastBackupAt: lastBackup, everyDays: backupEvery, snoozedUntil: backupSnooze, now: Date.now() });

  // ---- The day in numbers
  const facts = useMemo(() => todayFacts(txns, cats, rec.recurring, today), [txns, cats, rec.recurring, today]);
  const budgetTotal = useMemo(
    () =>
      budgetProgress(budgets, months.get(month), month, today)
        .filter((b) => !isBillCategory(b.categoryId))
        .reduce((s, b) => s + b.limit, 0),
    [budgets, months, month, today],
  );
  const target = paceTarget(facts, budgetTotal);
  // Bills paid so far this month: Spending's total is everyday + bills.
  const billsPaid = Math.max(0, months.get(month)?.bills ?? 0);
  const p = target ? pace(facts, target) : null;
  const checking = useMemo(
    () => accounts.filter((a) => !a.archived && (a.type === 'checking' || a.type === 'cash')).reduce((s, a) => s + accountBalance(a, txns), 0),
    [accounts, txns],
  );
  // Bills before the next paycheck, or in the next week when no paycheck is tracked.
  const flow = rec.cashFlow;
  const billItems = flow ? flow.items : rec.upcomingItems.filter((i) => isOutflow(i.status.rec) && i.date <= addDays(today, 7));
  const billsDue = billItems.reduce((s, i) => s + Math.abs(i.amount), 0);
  const paycheck = flow ? rec.statuses.find((s) => s.rec.kind === 'income' && s.rec.status === 'active') : undefined;
  const readiness = useMemo(
    () => spendReadiness({ facts, target, cash: checking, billsDue, liquid: plan?.cash ?? checking, monthlySpending: plan?.monthlySpending ?? 0 }),
    [facts, target, checking, billsDue, plan],
  );
  const changes = useMemo(() => categoryChanges(facts), [facts]);
  const catName = (id: string) => cats.get(id)?.name ?? 'Other';
  const summary = todaySummary({
    facts,
    target,
    monthName,
    categoryName: catName,
    bills: { count: billItems.length, total: billsDue, payday: flow ? { label: dayName(flow.payday, today) } : undefined, covered: checking >= billsDue },
  });
  const hot = changes.hot[0];
  const cool = changes.cool[0];
  const cushionMonths = plan && plan.monthlySpending > 0 ? plan.cash / plan.monthlySpending : null;

  const addAccount = () => nav.present((close) => <AccountEditor onClose={close} />);
  const importFile = () => nav.present((close) => <ImportFlow onClose={close} />);
  const editBudgets = () => nav.present((close) => <BudgetsEditor onClose={close} />);

  // ---- Money on hand: cash you can spend, savings, and what's on your cards.
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const onHand = useMemo(() => {
    const sum = (types: string[]) => {
      const list = open.filter((a) => types.includes(a.type));
      return list.length ? list.reduce((s, a) => s + accountBalance(a, txns), 0) : null;
    };
    const cash = sum(['checking', 'cash', 'wallet']);
    const savings = sum(['savings']);
    const cards = sum(['credit']);
    return [
      cash != null && { label: 'checking & cash', amount: cash },
      savings != null && { label: 'savings', amount: savings },
      cards != null && { label: 'on cards', amount: -cards, owed: true },
    ].filter((h): h is { label: string; amount: number; owed?: boolean } => !!h);
  }, [open, txns]);

  // ---- The latest few transactions (not ones dated in the future).
  const recent = useMemo(() => txns.filter((t) => t.date <= today).slice(0, 3), [txns, today]);

  // ---- To do: everything that wants a minute of your time, most important first, in one list.
  const todos: Todo[] = [];
  if (showBackup)
    todos.push({
      key: 'backup',
      glyph: 'shield',
      hue: 'red',
      title: 'Back up your data',
      sub: `${lastBackup ? `Last backup ${Math.floor((Date.now() - lastBackup) / 86_400_000)} days ago.` : 'No backup yet.'} It only lives on this phone.`,
      open: () => nav.present((close) => <BackupSheet onClose={close} />),
      later: () => void setMeta('backupSnoozeUntil', Date.now() + BACKUP_SNOOZE_DAYS * 86_400_000),
    });
  if (uncategorized > 0)
    todos.push({
      key: 'uncategorized',
      glyph: 'tag',
      hue: 'orange',
      title: `${uncategorized} transaction${uncategorized === 1 ? '' : 's'} to categorize`,
      sub: ai.embed ? 'Or let the on-device AI suggest categories' : 'The app offers to remember each one',
      open: () => (ai.embed ? nav.present((close) => <SuggestCategories onClose={close} />) : nav.showActivity({ categoryId: 'uncategorized' })),
    });
  if (rec.suggestions.length > 0 && rec.recurring.length === 0)
    todos.push({
      key: 'bills',
      glyph: 'repeat',
      hue: 'violet',
      title: `Review ${rec.suggestions.length} possible bill${rec.suggestions.length === 1 ? '' : 's'}`,
      sub: 'Subscriptions and bills that repeat',
      open: () => nav.present((close) => <RecurringReview onClose={close} />),
    });
  if (budgets.length === 0 && txns.length > 0)
    todos.push({
      key: 'budgets',
      glyph: 'target',
      hue: 'yellow',
      title: 'Set up monthly budgets',
      sub: 'Suggested from your last 3 months',
      open: editBudgets,
    });
  if (appNudges.paybacks.length > 0 || appNudges.unexplained.length > 0)
    todos.push({
      key: 'payments',
      glyph: 'swap',
      hue: 'blue',
      title:
        appNudges.paybacks.length > 0
          ? appNudges.paybacks.length === 1
            ? `${appNudges.paybacks[0].who} paid you back ${formatMoney(appNudges.paybacks[0].txn.amount)}?`
            : `${appNudges.paybacks.length} friends paid you back?`
          : appNudges.unexplained.length === 1
            ? 'What was this payment?'
            : `What were these ${appNudges.unexplained.length} payments?`,
      sub: appNudges.paybacks.length > 0 ? 'One tap marks it paid back' : 'Venmo, Cash App or Apple Cash',
      open: () => nav.present((close) => <WhatWasThis onClose={close} />),
    });
  if (owed.length > 0)
    todos.push({
      key: 'owed',
      glyph: 'users',
      hue: 'blue',
      title: `${formatMoney(owedTotal)} owed to you`,
      sub: `${owed
        .slice(0, 2)
        .map((o) => `${o.who} ${formatMoney(o.total)}`)
        .join(' · ')}${owed.length > 2 ? ` · +${owed.length - 2} more` : ''}`,
      open: () => nav.present((close) => <OwedSheet onClose={close} />),
    });
  if (aiPicks > 0)
    todos.push({
      key: 'ai',
      glyph: 'spark',
      hue: 'violet',
      title: `Check ${aiPicks} AI-categorized transaction${aiPicks === 1 ? '' : 's'}`,
      sub: 'Confirming them teaches it',
      open: () => nav.present((close) => <ReviewAiPicks onClose={close} />),
    });
  if (oldGuesses > 0 && !tidyDone)
    todos.push({
      key: 'tidy',
      glyph: 'wrench',
      hue: 'gray',
      title: `Tidy up ${oldGuesses} guessed categor${oldGuesses === 1 ? 'y' : 'ies'}`,
      sub: 'Older transactions filed by a guess',
      open: () => nav.present((close) => <TidyUp onClose={close} />),
    });
  if (stale.length > 0)
    todos.push({
      key: 'values',
      glyph: 'trend',
      hue: 'aqua',
      title: `Update ${stale.length === 1 ? stale[0].name : 'investment & vehicle values'}`,
      sub: 'Over a month old. Keeps net worth right',
      open: () => nav.present((close) => <UpdateValues onClose={close} />),
    });
  if (cushionMonths != null && cushionMonths < 3 && plan)
    todos.push({
      key: 'cushion',
      glyph: 'vault',
      hue: 'blue',
      title: 'Grow your cushion to 3 months',
      sub: `Your cash covers ${cushionMonths.toFixed(1)} months of spending`,
      open: () => nav.present((close) => <RunwayCalc data={plan} onClose={close} />),
    });
  if (!isStandalone())
    todos.push({
      key: 'install',
      glyph: 'phone',
      hue: 'gray',
      title: 'Add to your Home Screen',
      sub: 'In Safari: Share → Add to Home Screen. Opens full-screen and works offline',
    });

  const openCategory = (id: string) => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />);

  return (
    <>
      <header class="large-title">
        <div class="title-stack">
          <p class="title-date">{formatLongDay(today)}</p>
          <h1>Today</h1>
        </div>
        <div class="header-actions">
          {open.length > 0 && (
            <>
              <button type="button" class="icon-button" aria-label="Ask a question" onClick={() => nav.setTab('search')}>
                {Icons.sparkle()}
              </button>
            </>
          )}
          <ProfileButton />
        </div>
      </header>

      {open.length === 0 ? (
        <Empty icon="shield" title="Welcome">
          <p>
            Everything you enter stays on this device. Nothing is sent anywhere. Start by adding an account, or import a file you downloaded from your bank.
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
          {/* Copies throw off every number below, so this comes first. */}
          {copies.length > 0 && (
            <button type="button" class="callout warn top-callout" onClick={() => nav.present((close) => <DuplicatesSheet onClose={close} />)}>
              <strong>
                <Glyph name="alert" /> {copies.length} transaction{copies.length === 1 ? ' was' : 's were'} imported twice
              </strong>
              <p>The same month came in from two kinds of file (like CSV and QFX). Tap to review and remove the copies.</p>
            </button>
          )}

          {summary.length > 0 && (
            <section class="card lit day-summary" aria-labelledby="day-h">
              <div class="day-summary-head">
                <h2 id="day-h">
                  <Glyph name="spark" /> Your day in money
                </h2>
              </div>
              <p class="day-summary-text">
                {summary.map((s) => (
                  <Sentence phrases={s} />
                ))}
              </p>
              {(hot || cool || billItems.length > 0) && (
                <div class="day-summary-actions">
                  {[hot, cool].map(
                    (c) =>
                      c && (
                        <button type="button" class="pill" onClick={() => openCategory(c.categoryId)}>
                          See {catName(c.categoryId)}
                        </button>
                      ),
                  )}
                  {billItems.length > 0 && (
                    <button type="button" class="pill" onClick={() => document.getElementById('bills')?.scrollIntoView({ behavior: 'smooth' })}>
                      {flow ? 'Bills before payday' : 'Bills this week'}
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          <div class="today-tiles">
            <button
              type="button"
              class="card lit readiness-tile"
              style={{ '--lit': `color-mix(in oklab, ${verdictColor(readiness.verdict)} 16%, transparent)` }}
              aria-label={`Spend Readiness ${readiness.score} out of 10, ${readiness.verdict}. Open details.`}
              onClick={() => nav.present((close) => <ReadinessSheet readiness={readiness} onClose={close} />)}
            >
              <span class="tile-head">
                <span class="card-label">Spend Readiness</span>
                <span class="chevron" aria-hidden="true">
                  ›
                </span>
              </span>
              <span class="gauge-wrap">
                <Gauge score={readiness.score} verdict={readiness.verdict} size={124} stroke={11} live />
                <span class="gauge-center">
                  <CountUp class="gauge-score num" value={readiness.score} format={String} />
                  <span class="gauge-of">of 10</span>
                </span>
              </span>
              <span class="readiness-verdict small">
                <span class="verdict-dot" style={{ background: verdictColor(readiness.verdict) }} aria-hidden="true" />
                {readiness.verdict}
              </span>
            </button>

            {target && p ? (
              <button type="button" class="card left-tile" onClick={budgets.length ? () => nav.setTab('spending') : editBudgets}>
                <span class="card-label">{p.left >= 0 ? 'Left to spend' : 'Over by'}</span>
                <CountUp class={`left-value num ${p.left < 0 ? 'neg-text' : ''}`} value={Math.abs(p.left)} format={whole} />
                <span class="left-sub">
                  {p.daysLeft} day{p.daysLeft === 1 ? '' : 's'} left
                  {p.left > 0 && (
                    <>
                      {' '}
                      · about <strong>{whole(p.left / p.daysLeft)} a day</strong>
                    </>
                  )}
                </span>
                <span class="left-bar" aria-hidden="true">
                  <span class="left-fill" style={{ width: `${Math.min(100, (facts.spent / target.amount) * 100)}%` }} />
                  <span class="left-pace" style={{ left: `${Math.min(100, (p.expected / target.amount) * 100)}%` }} />
                </span>
                <span class="left-foot">
                  <span>
                    {whole(facts.spent)} of {whole(target.amount)}
                  </span>
                  <span>{target.kind === 'budget' ? 'budget' : 'usual'}</span>
                </span>
              </button>
            ) : (
              <button type="button" class="card left-tile" onClick={editBudgets}>
                <span class="card-label">This month</span>
                <CountUp class="left-value num" value={facts.spent} format={whole} />
                <span class="left-sub">everyday spending so far</span>
                <span class="pill left-cta">Set budgets</span>
              </button>
            )}
          </div>

          {target && p && facts.curve.length > 0 && (
            <section class="card lit pace-card" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 12%, transparent)' }} aria-labelledby="pace-h">
              <div class="pace-head">
                <IconChip name="trend" hue="blue" size="sm" />
                <h2 id="pace-h">{monthName} everyday spending</h2>
              </div>
              <PaceChart
                curve={facts.curve}
                days={facts.days}
                target={target.amount}
                targetLabel={target.kind === 'budget' ? 'Budget' : 'Usual'}
                monthShort={monthShort}
              />
              {billsPaid > 0 && (
                <button type="button" class="pace-foot" onClick={() => nav.setTab('spending')}>
                  Plus {whole(billsShown(facts.spent, billsPaid))} in bills like rent: {whole(facts.spent + billsPaid)} spent in all
                </button>
              )}
            </section>
          )}

          {rec.alerts.map((a) => (
            <AlertCard key={a.key} alert={a} />
          ))}

          {billItems.length > 0 && (
            <div id="bills">
              <Section
                title={
                  <>
                    <span>{flow ? 'Before payday' : 'Coming up this week'}</span>
                    <button type="button" class="link" onClick={() => nav.setTab('recurring')}>
                      All bills
                    </button>
                  </>
                }
                footer={
                  flow
                    ? `Paycheck ${dayName(flow.payday, today)}${paycheck ? ` · +${whole(Math.abs(paycheck.expected))}` : ''}. ${whole(billsDue)} due before then, ${whole(checking)} in checking${checking >= billsDue ? ': you’re covered.' : '.'}`
                    : `${whole(billsDue)} due, ${whole(checking)} in checking.`
                }
              >
                {billItems.map((i) => (
                  <RecurringRow status={i.status} today={today} date={i.date} late={i.late} category={cats.get(i.status.rec.categoryId ?? '')} />
                ))}
              </Section>
            </div>
          )}

          {onHand.length > 0 && (
            <button
              type="button"
              class="card on-hand"
              onClick={() => nav.setTab('accounts')}
              aria-label={`Money on hand: ${onHand.map((h) => `${h.label} ${whole(h.amount)}`).join(', ')}. Open Net Worth.`}
            >
              <span class="tile-head">
                <span class="card-label">Money on hand</span>
                <span class="chevron" aria-hidden="true">
                  ›
                </span>
              </span>
              <span class="on-hand-stats">
                {onHand.map((h) => (
                  <span class="on-hand-stat">
                    <span class={`on-hand-value num ${h.owed && h.amount > 0 ? 'neg-text' : ''}`}>{whole(h.amount)}</span>
                    <span class="card-sub">{h.label}</span>
                  </span>
                ))}
              </span>
            </button>
          )}

          {recent.length > 0 && (
            <Section
              title={
                <>
                  <span>Recent</span>
                  <button type="button" class="link" onClick={() => nav.setTab('activity')}>
                    All activity
                  </button>
                </>
              }
            >
              {recent.map((t) => (
                <TransactionRow txn={t} category={cats.get(t.categoryId)} account={accountsById.get(t.accountId)} showDate />
              ))}
            </Section>
          )}

          <TodoList items={todos} />
        </>
      )}
    </>
  );
}
