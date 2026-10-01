import { useEffect, useMemo } from 'preact/hooks';
import { useAccounts, useBook, useMeta, useTransactions } from '../hooks';
import { staleValued } from '../lib/networth';
import { UpdateValues } from './UpdateValues';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { usePlanData } from '../planModel';
import { addDays, diffDays, formatLongDay, formatShortDate, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { budgetProgress } from '../lib/budgets';
import { accountBalance } from '../lib/balances';
import { isOutflow } from '../lib/recurring';
import { categoryChanges, isEverydayCategory, pace, paceTarget, spendReadiness, todayFacts, todaySummary, type CategoryChange, type Phrase } from '../lib/today';
import { CategoryIcon, Empty, Section } from '../components/ui';
import { Glyph, IconChip, Icons } from '../components/icons';
import { categoryLook } from '../components/look';
import { Gauge, verdictColor } from '../components/Gauge';
import { PaceChart } from '../components/PaceChart';
import { ProfileButton } from '../components/ProfileButton';
import { RecurringRow } from '../components/RecurringRow';
import { AccountEditor } from './AccountEditor';
import { ImportFlow } from './Import';
import { AlertCard } from './Recurring';
import { RecurringReview } from './RecurringReview';
import { BudgetsEditor } from './BudgetsEditor';
import { CategoryDetail } from './CategoryDetail';
import { AskSheet } from './AskSheet';
import { ReadinessSheet } from './Readiness';
import { SuggestCategories } from './SuggestCategories';
import { ReviewAiPicks } from './ReviewAiPicks';
import { TidyUp, useOldGuesses } from './TidyUp';
import { OwedSheet } from './Owed';
import { usePaymentAppNudges, WhatWasThis } from './People';
import { DuplicatesSheet, useImportCopies } from './Duplicates';
import { RecapPage, RecapStories, RecapTeaser } from './Recap';
import { RunwayCalc } from './plan/Runway';
import { autoRecapYear, yearPeriod } from '../lib/recap';
import { db, setMeta } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { owedByPerson, owedItems } from '../lib/lines';
import { useAi } from '../ai/client';

/** The automatic year in review is only considered once per app launch. */
let recapCheckedThisLaunch = false;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

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
  return (
    <>
      {props.phrases.map((p) => (p.tone ? <span class={p.tone === 'good' ? 'pos-text' : 'neg-text'}>{p.text}</span> : p.text))}{' '}
    </>
  );
}

/** This month vs the usual by this point, as two bars. */
function CompareBars(props: { change: CategoryChange; color: string }) {
  const max = Math.max(props.change.spent, props.change.usual, 1);
  const rows: [string, number, boolean][] = [
    ['This month', props.change.spent, true],
    ['Usual', props.change.usual, false],
  ];
  return (
    <div class="compare-bars">
      {rows.map(([label, v, on]) => (
        <div class="compare-row">
          <span class="compare-label">{label}</span>
          <span class="compare-track">
            <span class="compare-fill" style={{ width: `${(v / max) * 100}%`, background: on ? props.color : 'var(--track)' }} />
          </span>
          <span class="compare-value num">{whole(v)}</span>
        </div>
      ))}
    </div>
  );
}

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
  // One-time nudge to review old guessed categories (also always in Settings → Organize).
  const oldGuesses = useOldGuesses()?.length ?? 0;
  const tidyDone = useMeta<number>('tidyUpDone');
  const owed = useMemo(() => owedByPerson(owedItems(txns)), [txns]);
  const appNudges = usePaymentAppNudges();
  const copies = useImportCopies();
  // The year in review opens by itself once: in December (this year) or early January (last year),
  // when the app starts (never in the middle of something, like an import).
  const recapYear = autoRecapYear(today);
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
  const backupDue = txns.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 86_400_000);

  // ---- The day in numbers
  const facts = useMemo(() => todayFacts(txns, cats, rec.recurring, today), [txns, cats, rec.recurring, today]);
  const budgetTotal = useMemo(() => budgetProgress(budgets, months.get(month), month, today)
          .filter((b) => isEverydayCategory(b.categoryId))
          .reduce((s, b) => s + b.limit, 0), [budgets, months, month, today]);
  const target = paceTarget(facts, budgetTotal);
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
  const openCategory = (id: string) => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />);
  const lookColor = (id: string) => {
    const look = categoryLook(cats.get(id));
    return 'glyph' in look ? look.background.replace('--deep-', '--hue-') : 'var(--chart-1)';
  };

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
              <button type="button" class="icon-button" aria-label="Ask a question" onClick={() => nav.present((close) => <AskSheet onClose={close} />)}>
                {Icons.sparkle()}
              </button>
              <button type="button" class="icon-button" aria-label="Import a file" onClick={importFile}>
                {Icons.import()}
              </button>
            </>
          )}
          <ProfileButton />
        </div>
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
        <Empty icon="shield" title="Welcome">
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
          {/* Copies throw off every number below, so this comes first. */}
          {copies.length > 0 && (
            <button type="button" class="callout warn top-callout" onClick={() => nav.present((close) => <DuplicatesSheet onClose={close} />)}>
              <strong>
                ⚠️ {copies.length} transaction{copies.length === 1 ? ' was' : 's were'} imported twice
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
              {(hot || billItems.length > 0) && (
                <div class="day-summary-actions">
                  {hot && (
                    <button type="button" class="pill" onClick={() => openCategory(hot.categoryId)}>
                      See {catName(hot.categoryId)}
                    </button>
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
                <span class="chevron" aria-hidden="true">›</span>
              </span>
              <span class="gauge-wrap">
                <Gauge score={readiness.score} verdict={readiness.verdict} size={124} stroke={11} />
                <span class="gauge-center">
                  <span class="gauge-score num">{readiness.score}</span>
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
                <span class={`left-value num ${p.left < 0 ? 'neg-text' : ''}`}>{whole(Math.abs(p.left))}</span>
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
                <span class="left-value num">{whole(facts.spent)}</span>
                <span class="left-sub">everyday spending so far</span>
                <span class="pill left-cta">Set budgets</span>
              </button>
            )}
          </div>

          {target && p && facts.curve.length > 0 && (
            <section class="card lit pace-card" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 12%, transparent)' }} aria-labelledby="pace-h">
              <div class="pace-head">
                <IconChip name="trend" hue="blue" size="sm" />
                <h2 id="pace-h">{monthName} spending</h2>
                <span class={`pace-status ${p.under >= 0 ? 'pos-text' : 'neg-text'}`}>
                  {whole(Math.abs(p.under))} {p.under >= 0 ? 'under' : 'over'} pace
                </span>
              </div>
              <div class="pace-numbers">
                <div>
                  <span class="pace-big num">{whole(facts.spent)}</span>
                  <span class="card-sub">spent so far</span>
                </div>
                <div>
                  <span class="pace-big num muted">{whole(p.expected)}</span>
                  <span class="card-sub">at an even pace</span>
                </div>
              </div>
              <PaceChart curve={facts.curve} days={facts.days} target={target.amount} targetLabel={target.kind === 'budget' ? 'Budget' : 'Usual'} monthShort={monthShort} />
            </section>
          )}

          {rec.alerts.map((a) => (
            <AlertCard key={a.key} alert={a} />
          ))}

          {(hot || cool) && (
            <>
              <h2 class="section-heading today-heading">Highlights</h2>
              {[hot, cool].filter((c): c is CategoryChange => !!c).map((c) => (
                <button type="button" class="card highlight" onClick={() => openCategory(c.categoryId)}>
                  <span class="highlight-head">
                    <CategoryIcon category={cats.get(c.categoryId)} size="sm" />
                    <span class="highlight-title">{catName(c.categoryId)}</span>
                    <span class="card-sub">This month</span>
                    <span class="chevron" aria-hidden="true">›</span>
                  </span>
                  <span class="highlight-text">
                    {c.diff > 0
                      ? `${catName(c.categoryId)} is running hot: ${whole(c.spent)} so far, ${whole(c.diff)} more than usual by this point.`
                      : `You’ve spent ${whole(-c.diff)} less on ${catName(c.categoryId).toLowerCase()} than usual by now. Nice.`}
                  </span>
                  <CompareBars change={c} color={lookColor(c.categoryId)} />
                </button>
              ))}
            </>
          )}

          {billItems.length > 0 && (
            <div id="bills">
              <Section
                title={
                  <>
                    <span>{flow ? 'Before payday' : 'Due this week'}</span>
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

          <h2 class="section-heading today-heading">For you</h2>

          {cushionMonths != null && cushionMonths < 3 && plan && (
            <div class="card foryou">
              <div class="foryou-top">
                <IconChip name="vault" hue="blue" />
                <div>
                  <h3>Grow your cushion to 3 months</h3>
                  <p>
                    Your cash covers {cushionMonths.toFixed(1)} months of spending. Three months is a solid emergency fund; see what it takes to
                    get there.
                  </p>
                </div>
              </div>
              <div class="foryou-actions">
                <button type="button" class="pill primary" onClick={() => nav.present((close) => <RunwayCalc data={plan} onClose={close} />)}>
                  Make a plan
                </button>
              </div>
            </div>
          )}

          {budgets.length === 0 && txns.length > 0 && (
            <div class="card foryou">
              <div class="foryou-top">
                <IconChip name="target" hue="yellow" />
                <div>
                  <h3>Set up monthly budgets</h3>
                  <p>Limits are suggested from your last 3 months of everyday spending, and you can adjust any of them.</p>
                </div>
              </div>
              <div class="foryou-actions">
                <button type="button" class="pill primary" onClick={editBudgets}>
                  Set budgets
                </button>
              </div>
            </div>
          )}

          {stale.length > 0 && (
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

          {(appNudges.paybacks.length > 0 || appNudges.unexplained.length > 0) && (
            <button type="button" class="callout" onClick={() => nav.present((close) => <WhatWasThis onClose={close} />)}>
              <strong>
                💸{' '}
                {appNudges.paybacks.length > 0
                  ? appNudges.paybacks.length === 1
                    ? `${appNudges.paybacks[0].who} paid you back ${formatMoney(appNudges.paybacks[0].txn.amount)}?`
                    : `${appNudges.paybacks.length} friends paid you back?`
                  : appNudges.unexplained.length === 1
                    ? 'What was this payment?'
                    : `What were these ${appNudges.unexplained.length} payments?`}
              </strong>
              <p>
                {appNudges.paybacks.length > 0
                  ? 'Money from friends that matches what they owe you. One tap marks it paid back.'
                  : 'Venmo, Cash App or Apple Cash payments with no clue about what they were for.'}
                {appNudges.paybacks.length > 0 && appNudges.unexplained.length > 0 ? ` Plus ${appNudges.unexplained.length} payment${appNudges.unexplained.length === 1 ? '' : 's'} to explain.` : ''}
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
            <button type="button" class="callout warn" onClick={() => nav.openSettings()}>
              <strong>Back up your data</strong>
              <p>{lastBackup ? "It's been over two weeks since your last backup." : "You haven't made a backup yet."} Your data only lives on this phone. Tap to save a backup file.</p>
            </button>
          )}

          <RecapTeaser onOpen={() => nav.present((close) => <RecapPage onClose={close} />)} />
        </>
      )}
    </>
  );
}

