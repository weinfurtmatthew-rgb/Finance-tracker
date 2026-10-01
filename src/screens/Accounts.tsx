import { useMemo, useState } from 'preact/hooks';
import { useBook, useGoals, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import type { Account, AccountType } from '../types';
import { isLiability } from '../lib/balances';
import { addMonths, dayInMonth, formatShortDate, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { nextOnSchedule, occurrences } from '../lib/recurring';
import {
  balanceOn, changeSince, goalProgress, historyDates, isValued, netWorthHistory, staleValued, type GoalProgress, type Range,
} from '../lib/networth';
import { Empty, Money, Row, Section, Segmented } from '../components/ui';
import { LineChart } from '../components/charts';
import { Icons } from '../components/icons';
import { AccountEditor } from './AccountEditor';
import { ImportFlow } from './Import';
import { UpdateValues } from './UpdateValues';
import { GoalEditor } from './GoalEditor';

const GROUPS: { title: string; types: AccountType[]; icon: string }[] = [
  { title: 'Cash', types: ['checking', 'savings', 'cash', 'wallet'], icon: '🏦' },
  { title: 'Investments', types: ['brokerage'], icon: '📈' },
  { title: 'Vehicles', types: ['vehicle'], icon: '🚗' },
  { title: 'Credit cards', types: ['credit'], icon: '💳' },
  { title: 'Loans', types: ['loan'], icon: '🧾' },
  { title: 'Other', types: ['other'], icon: '📁' },
];

const pctText = (p: number | null) => (p == null ? '' : ` (${p >= 0 ? '+' : ''}${p.toFixed(1)}%)`);

function GoalRow(props: { p: GoalProgress; onClick: () => void }) {
  const { p } = props;
  const g = p.goal;
  const lines: string[] = [];
  if (p.done) lines.push('🎉 Goal reached!');
  else {
    lines.push(`${formatMoney(p.remaining, { whole: true })} to go`);
    if (p.projectedDate) lines.push(`At your recent pace of ${formatMoney(p.pace, { whole: true })}/mo you'll get there around ${monthLabel(monthKey(p.projectedDate))}.`);
    else lines.push('The linked account hasn’t grown over the last 3 months.');
    if (g.targetDate) {
      if (p.neededMonthly != null) {
        const per = p.neededPerPaycheck != null ? ` or ${formatMoney(p.neededPerPaycheck, { whole: true })} per paycheck (${p.paychecksLeft} left)` : '';
        lines.push(`${p.onTrack ? '✓ On track' : '⚠️ Behind'} for ${formatShortDate(g.targetDate)}: save ${formatMoney(p.neededMonthly, { whole: true })}/mo${per}.`);
      } else lines.push(`⚠️ Target date ${formatShortDate(g.targetDate)} has passed.`);
    }
  }
  return (
    <button type="button" class="goal-row" onClick={props.onClick}>
      <span class="meter-head">
        <span>
          <span aria-hidden="true">{g.emoji}</span> {g.name}
        </span>
        <span class="muted">
          {formatMoney(p.saved, { whole: true })} of {formatMoney(g.target, { whole: true })}
        </span>
      </span>
      <span
        class={`goal-track ${p.done ? 'done' : ''}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={g.target / 100}
        aria-valuenow={p.saved / 100}
        aria-label={`${g.name}: ${Math.round(p.ratio * 100)}%`}
      >
        <span class="goal-fill" style={{ width: `${Math.max(1, p.ratio * 100)}%` }} />
      </span>
      {lines.map((l) => (
        <span class="goal-sub">{l}</span>
      ))}
    </button>
  );
}

export function Accounts() {
  const nav = useNav();
  const book = useBook();
  const txns = useTransactions();
  const goals = useGoals();
  const rec = useRecurringModel();
  const today = rec.today;
  const [range, setRange] = useState<Range>('1y');
  const [view, setView] = useState<'net' | 'split'>('net');

  const accounts = book.accounts;
  const open = accounts.filter((a) => !a.archived);
  const hidden = accounts.filter((a) => a.archived);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns) m.set(t.accountId, (m.get(t.accountId) ?? 0) + 1);
    return m;
  }, [txns]);
  const balances = useMemo(() => new Map(accounts.map((a) => [a.id, balanceOn(book, a)])), [book, accounts]);
  const net = open.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
  const lastMonthEnd = dayInMonth(`${addMonths(monthKey(today), -1)}-01`, 0, 31);
  const change = useMemo(() => changeSince(book, lastMonthEnd), [book, lastMonthEnd]);
  const dates = useMemo(() => historyDates(book, today, range), [book, today, range]);
  const history = useMemo(() => netWorthHistory(book, dates), [book, dates]);
  const labels = dates.map((d, i) => (i === dates.length - 1 ? 'Today' : monthLabel(monthKey(d), { short: true })));
  const stale = staleValued(book, today);

  // Paydays (from the paycheck tracked under Recurring) for "per paycheck" goal amounts.
  const paydays = useMemo(() => {
    const income = rec.statuses.find((s) => s.rec.kind === 'income' && s.rec.status === 'active');
    const until = goals.reduce((m, g) => (g.targetDate && g.targetDate > m ? g.targetDate : m), today);
    if (!income || until === today) return [];
    let first = income.nextDue;
    while (first < today) first = nextOnSchedule(first, income.rec);
    return occurrences(first, until, income.rec, 500);
  }, [rec.statuses, goals, today]);
  const progress = useMemo(() => goals.map((g) => goalProgress(book, g, today, paydays)), [goals, book, today, paydays]);

  const edit = (account?: Account) => nav.present((close) => <AccountEditor account={account} onClose={close} />);
  const editGoal = (goal?: GoalProgress['goal']) => nav.present((close) => <GoalEditor goal={goal} onClose={close} />);
  const row = (a: Account) => {
    const b = balances.get(a.id) ?? 0;
    const valued = isValued(a);
    const lastVal = book.values.get(a.id)?.at(-1);
    return (
      <Row
        title={a.name}
        subtitle={
          valued
            ? lastVal
              ? `Value updated ${formatShortDate(lastVal.date)}`
              : 'Value not set yet'
            : [a.institution, a.last4 && `•••• ${a.last4}`, `${counts.get(a.id) ?? 0} transactions`, a.checkedOn && `✓ ${formatShortDate(a.checkedOn)}`]
                .filter(Boolean)
                .join(' · ')
        }
        detail={<Money cents={isLiability(a) ? -b : b} />}
        onClick={() => edit(a)}
      />
    );
  };

  return (
    <>
      <header class="large-title">
        <h1>Net Worth</h1>
        <div class="header-actions">
          <button type="button" class="icon-button" aria-label="Import a file" onClick={() => nav.present((close) => <ImportFlow onClose={close} />)}>
            {Icons.import()}
          </button>
          <button type="button" class="icon-button" aria-label="Add account" onClick={() => edit()}>
            {Icons.plus()}
          </button>
        </div>
      </header>
      {open.length === 0 ? (
        <Empty icon="bank" title="No accounts yet">
          <p>Add your checking, credit cards, investments and vehicles to see your net worth.</p>
          <button type="button" class="button primary" onClick={() => edit()}>
            Add Account
          </button>
        </Empty>
      ) : (
        <>
          <div class="hero">
            <Money cents={net} class="hero-value" />
            <span class={`change-line ${change.total > 0 ? 'pos-text' : change.total < 0 ? 'neg-text' : ''}`}>
              {change.total >= 0 ? '▲' : '▼'} {formatMoney(Math.abs(change.total), { whole: true })}
              {pctText(change.pct)} since {formatShortDate(lastMonthEnd)}
            </span>
          </div>

          {stale.length > 0 && (
            <button type="button" class="callout warn" onClick={() => nav.present((close) => <UpdateValues onClose={close} />)}>
              <strong>Update {stale.length === 1 ? stale[0].name : `${stale.length} values`}</strong>
              <p>Investment and vehicle values are over a month old (or not set). Tap to enter today's values.</p>
            </button>
          )}

          <div class="chart-controls">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'net', label: 'Net worth' },
                { value: 'split', label: 'Assets/debts' },
              ]}
            />
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: '6m', label: '6M' },
                { value: '1y', label: '1Y' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          {view === 'net' ? (
            <LineChart title="Net worth over time" dates={dates} labels={labels} series={[{ name: 'Net worth', color: 'var(--chart-1)', values: history.map((h) => h.net) }]} />
          ) : (
            <LineChart
              title="Assets and debts over time"
              dates={dates}
              labels={labels}
              series={[
                { name: 'Assets', color: 'var(--chart-1)', values: history.map((h) => h.assets) },
                { name: 'Debts', color: 'var(--chart-2)', values: history.map((h) => h.debts) },
              ]}
            />
          )}
          <p class="section-footer">Investment and vehicle values before your first update are shown at that first value.</p>

          {change.accounts.length > 0 && (
            <Section title={`Change since ${formatShortDate(lastMonthEnd)}`}>
              {change.accounts.slice(0, 6).map((c) => (
                <Row
                  title={c.account.name}
                  subtitle={`${formatMoney(isLiability(c.account) ? -c.from : c.from, { whole: true })} → ${formatMoney(isLiability(c.account) ? -c.to : c.to, { whole: true })}${isLiability(c.account) ? ' owed' : ''}`}
                  detail={
                    <span class={c.change > 0 ? 'pos-text' : ''}>
                      {c.change > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(c.change), { whole: true })}
                    </span>
                  }
                  chevron={false}
                />
              ))}
            </Section>
          )}

          <Section
            title={
              <>
                <span>Goals</span>
                <button type="button" class="link" onClick={() => editGoal()}>
                  Add
                </button>
              </>
            }
          >
            {progress.length === 0 ? (
              <button type="button" class="row link-row" onClick={() => editGoal()}>
                Add a savings goal
              </button>
            ) : (
              progress.map((p) => <GoalRow p={p} onClick={() => editGoal(p.goal)} />)
            )}
          </Section>

          {GROUPS.map((g) => {
            const items = open.filter((a) => g.types.includes(a.type));
            if (!items.length) return null;
            const total = items.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
            const owed = g.types.includes('credit') || g.types.includes('loan');
            return (
              <Section
                title={
                  <>
                    <span>
                      {g.icon} {g.title}
                    </span>
                    <Money cents={owed ? -total : total} />
                  </>
                }
              >
                {items.map(row)}
              </Section>
            );
          })}
          {open.some(isValued) && (
            <Section>
              <button type="button" class="row link-row" onClick={() => nav.present((close) => <UpdateValues onClose={close} />)}>
                Update Investment &amp; Vehicle Values
              </button>
            </Section>
          )}
          <p class="section-footer center">Credit cards and loans show the amount you owe.</p>
        </>
      )}
      {hidden.length > 0 && <Section title="Hidden">{hidden.map(row)}</Section>}
    </>
  );
}
