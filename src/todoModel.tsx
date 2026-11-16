/**
 * Everything that wants a minute of your time, most important first, in one list: Today's To do list
 * and the morning summary's (screens/Morning.tsx) are the same items.
 */
import { useMemo } from 'preact/hooks';
import { useAccounts, useBook, useMeta, useTransactions } from './hooks';
import { staleValued } from './lib/networth';
import { useNav } from './nav';
import { useRecurringModel } from './recurringModel';
import { useSpending } from './spendingModel';
import { usePlanData } from './planModel';
import { formatDate } from './lib/dates';
import { cdMaturityValue, cdStage } from './lib/cd';
import { iraDeadline, iraRoom, isIra } from './lib/ira';
import { is401k, k401Limit, k401Year, missedMatch } from './lib/k401';
import { useBirthYear, useIraSpots, usePay } from './retirementModel';
import { formatMoney } from './lib/money';
import type { GlyphName, Hue } from './components/icons';
import { UpdateValues } from './screens/UpdateValues';
import { AccountDetail } from './screens/AccountDetail';
import { CdMaturitySheet } from './screens/CdMaturity';
import { ContributionSheet, SpottedContributionsSheet } from './screens/Ira';
import { ratePct } from './screens/K401';
import { ScoreSheet } from './screens/Credit';
import { scoreDue, statementPayments } from './lib/credit';
import { useCreditScores } from './creditModel';
import { useInsights } from './portfolioModel';
import { HoldingSheet } from './screens/Holdings';
import { LOOK } from './screens/PortfolioInsights';
import { BackupSheet } from './screens/Backup';
import { BACKUP_SNOOZE_DAYS, backupDue, DEFAULT_BACKUP_EVERY_DAYS } from './lib/backup';
import { RecurringReview } from './screens/RecurringReview';
import { BudgetsEditor } from './screens/BudgetsEditor';
import { SuggestCategories } from './screens/SuggestCategories';
import { ReviewAiPicks } from './screens/ReviewAiPicks';
import { TidyUp, useOldGuesses } from './screens/TidyUp';
import { OwedSheet } from './screens/Owed';
import { usePaymentAppNudges, WhatWasThis } from './screens/People';
import { RunwayCalc } from './screens/plan/Runway';
import { setMeta } from './db';
import { owedByPerson, owedItems } from './lib/lines';
import { useAi } from './ai/client';

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const whole = (c: number) => formatMoney(c, { whole: true });

/** "Later" on the 401(k) match reminder hides it this long. */
const MATCH_SNOOZE_DAYS = 90;
/** "Later" on the credit score reminder hides it this long. */
const SCORE_SNOOZE_DAYS = 14;
/** "Later" on an investments reminder hides them this long. */
const PORTFOLIO_SNOOZE_DAYS = 30;

/** Something on the To do list: one line, tap to deal with it. */
export interface Todo {
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

export function useTodos(): Todo[] {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const lastBackup = useMeta<number>('lastBackupAt');
  const rec = useRecurringModel();
  const ai = useAi();
  const plan = usePlanData();
  const { budgets } = useSpending();
  const today = rec.today;
  const open = accounts.filter((a) => !a.archived);
  const book = useBook();
  const iraSpots = useIraSpots();
  const birthYear = useBirthYear();
  const iraNudgesSkipped = useMeta<number[]>('iraNudgesSkipped');
  const pay = usePay();
  const matchSnoozedUntil = useMeta<number>('matchNudgeSnoozeUntil');
  const scores = useCreditScores();
  const scoreSnoozedUntil = useMeta<number>('scoreReminderSnoozeUntil');
  const statementsSkipped = useMeta<string[]>('statementNudgesSkipped');
  const insights = useInsights();
  const portfolioSnoozedUntil = useMeta<number>('portfolioNudgeSnoozeUntil');
  const stale = staleValued(book, today);
  const uncategorized = txns.filter((t) => t.categoryId === 'uncategorized').length;
  const aiPicks = txns.filter((t) => t.categorySource === 'ai').length;
  // One-time nudge to review old guessed categories (also always in Settings → Categories & Rules).
  const oldGuesses = useOldGuesses()?.length ?? 0;
  const tidyDone = useMeta<number>('tidyUpDone');
  const owed = useMemo(() => owedByPerson(owedItems(txns)), [txns]);
  const appNudges = usePaymentAppNudges();
  const owedTotal = owed.reduce((sum, p) => sum + p.total, 0);
  const backupEvery = useMeta<number>('backupEveryDays') ?? DEFAULT_BACKUP_EVERY_DAYS;
  const backupSnooze = useMeta<number>('backupSnoozeUntil');
  const showBackup = backupDue({ hasData: txns.length > 0, lastBackupAt: lastBackup, everyDays: backupEvery, snoozedUntil: backupSnooze, now: Date.now() });
  const cushionMonths = plan && plan.monthlySpending > 0 ? plan.cash / plan.monthlySpending : null;
  const editBudgets = () => nav.present((close) => <BudgetsEditor onClose={close} />);

  // ---- To do, most important first.
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
  // CDs: a heads-up two weeks before one matures, then the question of what happened to it.
  for (const a of open) {
    const stage = a.type === 'cd' ? cdStage(a, today) : null;
    if (stage === 'maturing')
      todos.push({
        key: `cd-${a.id}`,
        glyph: 'calendar',
        hue: 'green',
        title: `CD matures ${formatDate(a.maturesOn!)}`,
        sub: `${a.name}: about ${whole(cdMaturityValue(a, book.values.get(a.id) ?? []) ?? 0)} then. Shop rates now if you might move it`,
        open: () => nav.present((close) => <AccountDetail account={a} onClose={close} />),
      });
    else if (stage === 'matured')
      todos.push({
        key: `cd-${a.id}`,
        glyph: 'calendar',
        hue: 'green',
        title: `CD matured ${formatDate(a.maturesOn!)}`,
        sub: `${a.name}: did it renew, or did you move the money?`,
        open: () => nav.present((close) => <CdMaturitySheet account={a} onClose={close} />),
      });
  }
  // Cards: pay before a statement closes, so a balance under 10% of the limit is what gets reported.
  for (const p of statementPayments(open, book, today)) {
    const key = `${p.account.id}:${p.closes}`;
    if ((statementsSkipped ?? []).includes(key)) continue;
    todos.push({
      key: `statement:${p.account.id}`,
      glyph: 'card',
      hue: 'orange',
      title: `Pay ${whole(p.pay)} on ${p.account.name}`,
      sub: `${p.closes === today ? 'The statement closes today' : `Before the statement closes ${formatDate(p.closes)}`}, to report under 10% of the limit`,
      open: () => nav.present((close) => <AccountDetail account={p.account} onClose={close} />),
      // Skipped for this statement only (and forget ones that have passed).
      later: () => void setMeta('statementNudgesSkipped', [...(statementsSkipped ?? []).filter((k) => k.slice(-10) >= today), key]),
    });
  }
  // IRAs: transfers to a brokerage that may have been contributions, and last year's deadline (Apr 15).
  if (iraSpots.length)
    todos.push({
      key: 'ira-spots',
      glyph: 'sun',
      hue: 'yellow',
      title: iraSpots.length === 1 ? 'Was this an IRA contribution?' : `${iraSpots.length} possible IRA contributions`,
      sub:
        iraSpots.length === 1
          ? `${whole(-iraSpots[0].txn.amount)} on ${formatDate(iraSpots[0].txn.date)} · ${iraSpots[0].txn.payee || iraSpots[0].txn.description}`
          : 'Transfers to a brokerage from your bank files',
      open: () => nav.present((close) => <SpottedContributionsSheet onClose={close} />),
    });
  const lastYear = Number(today.slice(0, 4)) - 1;
  if (open.some(isIra) && today >= `${lastYear + 1}-03-01` && today <= iraDeadline(lastYear) && !(iraNudgesSkipped ?? []).includes(lastYear)) {
    const room = iraRoom(lastYear, txns, birthYear);
    if (room.left > 0)
      todos.push({
        key: 'ira-deadline',
        glyph: 'calendar',
        hue: 'yellow',
        title: `IRA: ${whole(room.left)} of ${lastYear} room left`,
        sub: `Contribute by ${formatDate(room.deadline)} to count it for ${lastYear}`,
        open: () => nav.present((close) => <ContributionSheet year={lastYear} onClose={close} />),
        later: () => void setMeta('iraNudgesSkipped', [...(iraNudgesSkipped ?? []), lastYear]),
      });
  }
  // 401(k): free money left on the table when you put in less than your employer would match.
  const short = open.find(
    (a) => is401k(a) && a.contributionRate != null && !!a.employerMatch && a.employerMatchUpTo != null && a.contributionRate < a.employerMatchUpTo,
  );
  const missed = short && pay ? missedMatch(k401Year(short, pay, k401Limit(Number(today.slice(0, 4)), birthYear).limit)) : null;
  if (short && missed !== 0 && !(matchSnoozedUntil && Date.now() < matchSnoozedUntil))
    todos.push({
      key: 'k401-match',
      glyph: 'gift',
      hue: 'green',
      title: 'Get your full 401(k) match',
      sub: `Put in ${ratePct(short.employerMatchUpTo!)} instead of ${ratePct(short.contributionRate!)}${missed ? `: ${whole(missed)} more a year` : ''}`,
      open: () => nav.present((close) => <AccountDetail account={short} onClose={close} />),
      later: () => void setMeta('matchNudgeSnoozeUntil', Date.now() + MATCH_SNOOZE_DAYS * 86_400_000),
    });
  // Investments: a dated fact coming up soon (a gain turning long-term, a loss before the year ends).
  const soon = insights.find((i) => i.soon);
  const soonAccount = soon && open.find((a) => a.id === soon.accountId);
  if (soon && soonAccount && soon.ticker && !(portfolioSnoozedUntil && Date.now() < portfolioSnoozedUntil))
    todos.push({
      key: `portfolio:${soon.key}`,
      glyph: LOOK[soon.kind].glyph,
      hue: LOOK[soon.kind].hue,
      title: soon.title,
      sub: soon.brief ?? soon.detail,
      open: () => nav.present((close) => <HoldingSheet account={soonAccount} ticker={soon.ticker!} onClose={close} />),
      later: () => void setMeta('portfolioNudgeSnoozeUntil', Date.now() + PORTFOLIO_SNOOZE_DAYS * 86_400_000),
    });
  // Credit score: a new one a month after the last, once you've started a log.
  const lastScore = scores.at(-1);
  if (lastScore && scoreDue(scores, today) && !(scoreSnoozedUntil && Date.now() < scoreSnoozedUntil))
    todos.push({
      key: 'credit-score',
      glyph: 'bars',
      hue: 'blue',
      title: 'Update your credit score',
      sub: `Last one: ${lastScore.score} on ${formatDate(lastScore.date)}`,
      open: () => nav.present((close) => <ScoreSheet onClose={close} />),
      later: () => void setMeta('scoreReminderSnoozeUntil', Date.now() + SCORE_SNOOZE_DAYS * 86_400_000),
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

  return todos;
}
