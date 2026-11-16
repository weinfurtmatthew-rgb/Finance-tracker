/**
 * The morning summary: one page with where you stand, what to do, what changed in the last 7 days and
 * what's coming in the next 7, how this month's spending is going, your stocks and your milestones; on
 * Mondays, where last week's money went (lib/morning.ts). It opens by itself the first time you open the
 * app on a morning (app.tsx), and from the sun button on Today any time.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useNav, type Nav, type Page, type Tab } from '../nav';
import { useAccounts, useBook, useGoals, useMeta, useTransactions } from '../hooks';
import { useRecurringModel, type Alert } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { useMoneyHealth } from '../healthModel';
import { useTodos, type Todo } from '../todoModel';
import { usePortfolio, usePrices, useSecurities } from '../portfolioModel';
import { useCreditScores } from '../creditModel';
import {
  burstLayout,
  dayPart,
  debtPaidDown,
  freshness,
  goalMilestone,
  greeting,
  isMonday,
  lastSevenDays,
  lastWeek,
  netWorthHigh,
  standing,
  weekAhead,
  worthALook,
  type WorthALook,
} from '../lib/morning';
import { formatMoney } from '../lib/money';
import { isLiability } from '../lib/balances';
import { addDays, diffDays, formatShortDate, monthKey, monthLabel, todayISO } from '../lib/dates';
import { goalProgress, historyStart, netWorthOn, type GoalProgress } from '../lib/networth';
import { budgetProgress, monthElapsed } from '../lib/budgets';
import { isBillCategory } from '../lib/spend';
import { pace, paceTarget, todayFacts } from '../lib/today';
import { BENCHMARK, holdingsByTicker, periodResult, periodStart, type Holding } from '../lib/portfolio';
import { fromHighText, MOOD_LABEL, moodOf, trendOf } from '../lib/market';
import { byDate, lastChange } from '../lib/credit';
import { Glyph, glyphPaths, IconChip, type GlyphName, type Hue } from '../components/icons';
import { categoryLook } from '../components/look';
import { CategoryLabel, Sheet } from '../components/ui';
import { RankedBars } from '../components/charts';
import { BudgetMeter } from '../components/BudgetMeter';
import { TransactionRow } from '../components/TransactionRow';
import { RecurringRow } from '../components/RecurringRow';
import { ImportFlow } from '../lazy';
import { setMeta } from '../db';
import type { Category, Cents, Transaction } from '../types';
import { alertText } from './Recurring';
import { RecurringDetail } from './RecurringDetail';
import { TransactionEditor } from './TransactionEditor';
import { CategoryDetail } from './CategoryDetail';
import { PortfolioSheet } from './Portfolio';
import { HoldingSheet } from './Holdings';
import { CreditSheet } from './Credit';
import { GoalEditor } from './GoalEditor';

/** The meta key holding the day it last opened by itself. */
export const MORNING_SEEN = 'morningSeen';
/** An optional first name for the greeting (Settings → Appearance). */
export const GREET_NAME = 'greetName';
/** The "Worth a look" items you've opened: they don't come back on later mornings. */
export const MORNING_LOOKED = 'morningLooked';
const LOOKED_KEEP = 200;

/** How many To do items show as cards (the rest are on Today). */
const TODO_CARDS = 3;
/** An account that moved at least this much in the 7 days gets a line. */
const ACCOUNT_MOVE = 100_00;
/** Circles in Monday's burst (more categories than that fold into one). */
const BURST_MAX = 6;
/** A holding that moved at least this much this week gets a line (the biggest few). */
const MOVER_PCT = 0.02;
const MOVERS = 3;
/** Owing at least this much less than a month ago is a milestone. */
const DEBT_MIN = 100_00;
/** A credit score from the last this-many days is news. */
const SCORE_NEWS_DAYS = 30;
/** Budgets to watch, at most. */
const BUDGETS_SHOWN = 3;

const whole = (c: number) => formatMoney(c, { whole: true });
const signed = (c: number) => `${c >= 0 ? '+' : '−'}${whole(Math.abs(c))}`;
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;
const tone = (x: number) => (x > 0 ? 'pos-text' : x < 0 ? 'neg-text' : '');
/** Within $25 or a tenth of it is "about" the same. */
const aboutSame = (diff: Cents, usual: Cents) => Math.abs(diff) <= Math.max(25_00, usual * 0.1);
const listed = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const weekday = (iso: string, style: 'long' | 'short' | 'narrow' = 'long') => dateOf(iso).toLocaleDateString('en-US', { weekday: style });
/** "Friday" within the week, else "Oct 24". */
const when = (iso: string, today: string) => (Math.abs(diffDays(today, iso)) < 7 ? weekday(iso) : formatShortDate(iso));

/** A number in the "Where you stand" grid; tapping goes to where it comes from. */
interface Tile {
  key: string;
  label: string;
  value: string;
  sub?: ComponentChildren;
  to: Tab | Page;
  owed?: boolean;
}

/** A section: a small colored tag for its name, then what's in it. */
function Part(props: { id: string; tag: string; hue?: Hue; aside?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="m-part" aria-labelledby={props.id}>
      <div class="m-part-head">
        <h2 id={props.id} class="m-tag" style={props.hue ? { '--tag': `var(--hue-${props.hue})` } : undefined}>
          {props.tag}
        </h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

/** One line in a list: an icon, what happened, and an amount; some open what they're about. */
function Line(props: { glyph: GlyphName; hue: Hue; title: ComponentChildren; sub?: ComponentChildren; detail?: ComponentChildren; onClick?: () => void }) {
  const inner = (
    <>
      <IconChip name={props.glyph} hue={props.hue} size="sm" />
      <span class="row-main">
        <span class="row-title wrap">{props.title}</span>
        {props.sub && <span class="row-subtitle wrap">{props.sub}</span>}
      </span>
      {props.detail != null && <span class="row-detail">{props.detail}</span>}
      {props.onClick && (
        <span class="chevron" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  return props.onClick ? (
    <button type="button" class="row m-line" onClick={props.onClick}>
      {inner}
    </button>
  ) : (
    <div class="row m-line">{inner}</div>
  );
}

/** The top of the To do list as a stack of colored cards; each opens what it's about. */
function TodoStack(props: { items: Todo[] }) {
  return (
    <div class="m-stack">
      {props.items.map((t) => {
        const inner = (
          <>
            <span class="m-todo-icon" aria-hidden="true">
              <Glyph name={t.glyph} />
            </span>
            <span class="m-todo-text">
              <span class="m-todo-title">{t.title}</span>
              <span class="m-todo-sub">{t.sub}</span>
            </span>
            {t.open && (
              <span class="m-todo-go" aria-hidden="true">
                <Glyph name="chevronRight" />
              </span>
            )}
          </>
        );
        return t.open ? (
          <button type="button" class="m-todo" key={t.key} style={{ '--c': `var(--deep-${t.hue})` }} onClick={t.open}>
            {inner}
          </button>
        ) : (
          <div class="m-todo" key={t.key} style={{ '--c': `var(--deep-${t.hue})` }}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Mondays: where last week's money went
// ---------------------------------------------------------------------------------------------

interface BurstItem {
  key: string;
  amount: Cents;
  category?: Category;
  /** The circle for the rest: how many categories are in it. */
  more?: number;
}

/** A circle's color: its category's chip color (a category you made: a deeper mix of its color). */
function bubbleFill(item: BurstItem) {
  if (item.more) return 'var(--deep-gray)';
  const look = categoryLook(item.category);
  return 'glyph' in look ? look.background : `color-mix(in srgb, ${item.category?.color || '#8e8e93'} 45%, var(--surface))`;
}

/** Overlapping circles, each one's area its share, with its category's icon; the list under it has the numbers. */
function Burst(props: { items: BurstItem[] }) {
  const W = 340;
  const { bubbles, height } = burstLayout(
    props.items.map((i) => i.amount),
    W,
  );
  return (
    <svg class="m-burst" viewBox={`0 0 ${W} ${Math.ceil(height)}`} aria-hidden="true">
      {props.items.map((item, i) => {
        const b = bubbles[i];
        const look = item.more ? null : categoryLook(item.category);
        const size = b.r * 0.92;
        return (
          <g key={item.key}>
            <circle class="m-bubble" cx={b.x} cy={b.y} r={b.r} style={{ fill: bubbleFill(item) }} />
            {item.more ? (
              <text class="m-bubble-text" x={b.x} y={b.y} style={{ fontSize: `${Math.max(11, b.r * 0.6)}px` }}>
                +{item.more}
              </text>
            ) : look && 'glyph' in look ? (
              b.r >= 9 && (
                <g class="m-bubble-glyph" transform={`translate(${b.x - size / 2} ${b.y - size / 2}) scale(${size / 24})`}>
                  {glyphPaths(look.glyph)}
                </g>
              )
            ) : (
              <text class="m-bubble-emoji" x={b.x} y={b.y} style={{ fontSize: `${b.r * 0.9}px` }}>
                {look?.emoji}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LastWeekPart(props: { today: string; go: (to: Tab | Page) => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const rec = useRecurringModel();
  const { cats } = useSpending();
  const week = useMemo(() => lastWeek(txns, cats, rec.recurring, props.today), [txns, cats, rec.recurring, props.today]);
  if (week.total <= 0) return null;
  const top = week.categories.length > BURST_MAX ? week.categories.slice(0, BURST_MAX - 1) : week.categories;
  const rest = week.categories.slice(top.length);
  const items: BurstItem[] = [
    ...top.map((c) => ({ key: c.categoryId, amount: c.amount, category: cats.get(c.categoryId) })),
    ...(rest.length ? [{ key: 'more', amount: rest.reduce((s, c) => s + c.amount, 0), more: rest.length }] : []),
  ];
  // A category's page opens on the month most of the week was in.
  const month = monthKey(addDays(week.from, 3));
  const diff = week.usual != null ? week.total - week.usual : null;
  return (
    <Part
      id="m-lastweek"
      tag="Last week"
      hue="magenta"
      aside={
        <button type="button" class="link" onClick={() => props.go('spending')}>
          Spending
        </button>
      }
    >
      <div class="card m-lastweek">
        <span class="m-big num">{whole(week.total)}</span>
        <span class="m-big-sub">
          Spent {formatShortDate(week.from)} to {formatShortDate(week.to)}
          {diff != null && week.usual != null
            ? aboutSame(diff, week.usual)
              ? ', about a usual week'
              : `, ${whole(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than a usual week (${whole(week.usual)})`
            : ''}
        </span>
        <Burst items={items} />
      </div>
      <RankedBars
        items={items.map((i) => ({
          key: i.key,
          label: i.more ? `${i.more} other categories` : <CategoryLabel category={i.category} />,
          value: i.amount,
          share: `${Math.round((i.amount / week.total) * 100)}%`,
        }))}
        onSelect={(key) => (key === 'more' ? props.go('spending') : nav.present((close) => <CategoryDetail categoryId={key} month={month} onClose={close} />))}
      />
      {week.places.length > 0 && (
        <p class="section-footer">
          Most of it went to {listed(week.places.map((p) => `${p.name} (${whole(p.amount)}${p.count > 1 ? `, ${p.count} times` : ''})`))}.
        </p>
      )}
    </Part>
  );
}

// ---------------------------------------------------------------------------------------------
// Worth a look: charges that stand out, and the bill alerts
// ---------------------------------------------------------------------------------------------

interface Look {
  key: string;
  /** The likeliest mistakes first. */
  rank: number;
  glyph: GlyphName;
  hue: Hue;
  title: string;
  sub: string;
  open: (nav: Nav) => void;
}

const placeOf = (t: Transaction) => t.payee || t.description;
const charge = (t: Transaction) => formatMoney(Math.abs(t.amount));
const editTxn = (t: Transaction) => (nav: Nav) => nav.present((close) => <TransactionEditor txn={t} onClose={close} />);

function chargeLook(l: WorthALook, today: string): Look {
  const t = l.txn;
  const day = when(t.date, today);
  const base = { key: l.key, open: editTxn(t) };
  if (l.kind === 'double') {
    const other = l.other!;
    const sub = other.date === t.date ? `${charge(t)} twice on ${day}.` : `${charge(t)} on ${when(other.date, today)} and again on ${day}.`;
    return {
      ...base,
      rank: 0,
      glyph: 'alert',
      hue: 'red',
      title: `Charged twice at ${placeOf(t)}?`,
      sub: `${sub} If it’s a mistake, your bank can reverse one.`,
    };
  }
  if (l.kind === 'fee')
    return { ...base, rank: 2, glyph: 'receipt', hue: 'red', title: `${placeOf(t)}: ${charge(t)}`, sub: `${day}. Banks often waive a fee if you ask.` };
  if (l.kind === 'unusual')
    return { ...base, rank: 3, glyph: 'up', hue: 'orange', title: `${placeOf(t)}: ${charge(t)}`, sub: `${day}. Usually about ${whole(l.usual!)} there.` };
  return { ...base, rank: 5, glyph: 'spark', hue: 'blue', title: `First time at ${placeOf(t)}`, sub: `${charge(t)} on ${day}.` };
}

function alertLook(a: Alert): Look {
  const [title, sub] = alertText(a);
  const open = (nav: Nav) => nav.present((close) => <RecurringDetail id={a.status.rec.id} onClose={close} />);
  if (a.type === 'after-cancel') return { key: a.key, rank: 1, glyph: 'alert', hue: 'red', title, sub, open };
  if (a.type === 'price') return { key: a.key, rank: 4, glyph: 'up', hue: 'orange', title, sub, open };
  return { key: a.key, rank: a.type === 'trial-ending' ? 6 : 7, glyph: 'hourglass', hue: 'blue', title, sub, open };
}

function WorthALookPart(props: { today: string }) {
  const nav = useNav();
  const txns = useTransactions();
  const rec = useRecurringModel();
  const { cats } = useSpending();
  const looked = useMeta<string[]>(MORNING_LOOKED);
  // Ones opened just now stay until the summary closes, so the list doesn't shift under your finger.
  const [openedNow, setOpenedNow] = useState<string[]>([]);
  const found = useMemo(() => worthALook(txns, cats, props.today), [txns, cats, props.today]);
  const seen = new Set(looked ?? []);
  const looks = [...found.map((l) => chargeLook(l, props.today)), ...rec.alerts.map(alertLook)]
    .filter((l) => !seen.has(l.key) || openedNow.includes(l.key))
    .sort((a, b) => a.rank - b.rank);
  if (!looks.length) return null;
  const open = (l: Look) => {
    setOpenedNow((o) => [...o, l.key]);
    if (!seen.has(l.key)) void setMeta(MORNING_LOOKED, [...(looked ?? []), l.key].slice(-LOOKED_KEEP));
    l.open(nav);
  };
  return (
    <Part id="m-look" tag="Worth a look" hue="red">
      <div class="group">
        {looks.map((l) => (
          <Line key={l.key} glyph={l.glyph} hue={l.hue} title={l.title} sub={l.sub} onClick={() => open(l)} />
        ))}
      </div>
    </Part>
  );
}

// ---------------------------------------------------------------------------------------------
// This month: spending against your budgets (or a usual month), and the budgets to watch
// ---------------------------------------------------------------------------------------------

function ThisMonthPart(props: { today: string; go: (to: Tab | Page) => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const rec = useRecurringModel();
  const { months, budgets, cats } = useSpending();
  const month = monthKey(props.today);
  const facts = useMemo(() => todayFacts(txns, cats, rec.recurring, props.today), [txns, cats, rec.recurring, props.today]);
  const progress = useMemo(() => budgetProgress(budgets, months.get(month), month, props.today), [budgets, months, month, props.today]);
  const target = paceTarget(
    facts,
    progress.filter((b) => !isBillCategory(b.categoryId)).reduce((s, b) => s + b.limit, 0),
  );
  if (!target && !progress.length) return null;
  const p = target ? pace(facts, target) : null;
  const watch = progress.filter((b) => b.state !== 'ok' || b.offPace).sort((a, b) => b.ratio - a.ratio);
  const elapsed = monthElapsed(month, props.today);
  const open = (id: string) => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />);
  return (
    <Part
      id="m-month"
      tag={monthLabel(month).split(' ')[0]}
      hue="yellow"
      aside={
        <button type="button" class="link" onClick={() => props.go('spending')}>
          Spending
        </button>
      }
    >
      {p && target && (
        <div class="group">
          <Line
            glyph="calendar"
            hue={p.under >= 0 ? 'green' : 'orange'}
            title={Math.abs(p.under) < 10_00 ? 'Right on pace' : `${whole(Math.abs(p.under))} ${p.under > 0 ? 'under' : 'over'} pace`}
            sub={`${whole(facts.spent)} spent so far, against ${whole(target.amount)} ${target.kind === 'budget' ? 'in your budgets' : 'in a usual month'}. ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} to go.`}
          />
        </div>
      )}
      {watch.length > 0 ? (
        <>
          <h3 class="m-sub">{watch.length === 1 ? 'A budget to watch' : 'Budgets to watch'}</h3>
          <div class="group">
            {watch.slice(0, BUDGETS_SHOWN).map((b) => (
              <BudgetMeter progress={b} category={cats.get(b.categoryId)} elapsed={elapsed} onClick={() => open(b.categoryId)} />
            ))}
          </div>
        </>
      ) : (
        progress.length > 0 && <p class="section-footer">Every budget is on track.</p>
      )}
    </Part>
  );
}

// ---------------------------------------------------------------------------------------------
// Your stocks: what they're worth, the last day and the week, what moved, and the market
// ---------------------------------------------------------------------------------------------

function StocksPart(props: { today: string }) {
  const nav = useNav();
  const p = usePortfolio();
  const prices = usePrices();
  const securities = useSecurities();
  const accounts = useAccounts();
  const facts = useMemo(() => {
    if (!p) return null;
    const week = periodResult(p, periodStart(p, '1w', props.today));
    const day = p.priceDate ? periodResult(p, periodStart(p, '1d', props.today)) : null;
    const movers = holdingsByTicker(p, addDays(props.today, -7))
      .filter((h) => h.pct != null && Math.abs(h.pct) >= MOVER_PCT)
      .sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!))
      .slice(0, MOVERS);
    return { week, day, movers };
  }, [p, props.today]);
  const market = useMemo(() => trendOf(prices.get(BENCHMARK)), [prices]);
  if (!p || !facts) return null;
  const { week, day, movers } = facts;
  const lastClose = day && day.pct != null && p.priceDate ? { pct: day.pct, gain: day.gain, date: p.priceDate } : null;
  const portfolio = () => nav.present((close) => <PortfolioSheet onClose={close} />);
  const holding = (h: Holding) => {
    const pos = [...h.positions].sort((a, b) => b.value - a.value)[0];
    const account = accounts.find((a) => a.id === pos.accountId);
    if (account) nav.present((close) => <HoldingSheet account={account} ticker={h.ticker} onClose={close} />);
  };
  return (
    <Part
      id="m-stocks"
      tag="Your stocks"
      hue="aqua"
      aside={
        <button type="button" class="link" onClick={portfolio}>
          Portfolio
        </button>
      }
    >
      <div class={`card m-grid${lastClose ? '' : ' single'}`}>
        <button type="button" class="m-stat" onClick={portfolio}>
          <span class="m-stat-label">Investments</span>
          <span class="m-stat-value num">{whole(week.endValue)}</span>
          <span class="m-stat-sub">
            {week.gain === 0 ? (
              'Same as a week ago'
            ) : (
              <span class={tone(week.gain)}>
                {week.gain > 0 ? '▲' : '▼'} {whole(Math.abs(week.gain))} this week
              </span>
            )}
          </span>
        </button>
        {lastClose && (
          <button type="button" class="m-stat" onClick={portfolio}>
            <span class="m-stat-label">Last close</span>
            <span class={`m-stat-value num ${tone(lastClose.pct)}`}>{pct(lastClose.pct)}</span>
            <span class="m-stat-sub">
              {lastClose.gain === 0 ? 'No change' : `${lastClose.gain > 0 ? '▲' : '▼'} ${whole(Math.abs(lastClose.gain))}`}, {when(lastClose.date, props.today)}
            </span>
          </button>
        )}
      </div>
      {(movers.length > 0 || market?.fullYear) && (
        <div class="group m-after">
          {movers.map((h) => (
            <Line
              key={h.ticker}
              glyph={h.pct! > 0 ? 'up' : 'down'}
              hue={h.pct! > 0 ? 'green' : 'red'}
              title={`${h.ticker} ${h.pct! > 0 ? 'up' : 'down'} ${Math.abs(h.pct! * 100).toFixed(1)}% this week`}
              sub={securities.get(h.ticker)?.name}
              onClick={() => holding(h)}
            />
          ))}
          {market?.fullYear && (
            <Line
              glyph="trend"
              hue="aqua"
              title={`The market: ${MOOD_LABEL[moodOf(market)].toLowerCase()}`}
              sub={`The S&P 500 is ${fromHighText(market)} of the last year.`}
            />
          )}
        </div>
      )}
    </Part>
  );
}

// ---------------------------------------------------------------------------------------------
// Milestones: goals, a new high, debt paid down, a credit score that moved
// ---------------------------------------------------------------------------------------------

function GoalLine(props: { p: GoalProgress; mark: 25 | 50 | 75 | 100 | null; onClick: () => void }) {
  const { p, mark } = props;
  const g = p.goal;
  const sub =
    mark === 100
      ? 'Reached this week!'
      : p.done
        ? 'Goal reached!'
        : `${mark ? `Passed ${mark === 50 ? 'halfway' : `${mark}%`} this week. ` : ''}${whole(p.remaining)} to go${
            p.projectedDate ? `, around ${monthLabel(monthKey(p.projectedDate))} at your pace` : ''
          }.`;
  return (
    <button type="button" class="goal-row" onClick={props.onClick}>
      <span class="meter-head">
        <span>
          <span aria-hidden="true">{g.emoji}</span> {g.name}
        </span>
        <span class="muted">
          {whole(p.saved)} of {whole(g.target)}
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
      <span class={`goal-sub${mark ? ' m-mark' : ''}`}>{sub}</span>
    </button>
  );
}

function MilestonesPart(props: { today: string }) {
  const nav = useNav();
  const book = useBook();
  const goals = useGoals();
  const scores = useCreditScores();
  const high = useMemo(() => netWorthHigh(book, props.today), [book, props.today]);
  const start = historyStart(book);
  const paid = useMemo(() => debtPaidDown(book, addDays(props.today, -30)), [book, props.today]);
  const progress = useMemo(
    () => goals.map((g) => ({ p: goalProgress(book, g, props.today), mark: goalMilestone(book, g, props.today) })),
    [goals, book, props.today],
  );
  const latest = byDate(scores).at(-1);
  const change = lastChange(scores);
  const score = latest && change && change.change !== 0 && diffDays(latest.date, props.today) <= SCORE_NEWS_DAYS ? change : null;
  const news = high || paid >= DEBT_MIN || !!score;
  if (!news && !goals.length) return null;
  return (
    <Part id="m-miles" tag="Milestones" hue="magenta">
      {news && (
        <div class="group">
          {high && start && (
            <Line
              glyph="flag"
              hue="green"
              title="Net worth at a new high"
              sub={`${whole(netWorthOn(book).net)}: higher than any day since ${monthLabel(monthKey(start))}`}
            />
          )}
          {paid >= DEBT_MIN && <Line glyph="card" hue="green" title={`${whole(paid)} less owed than a month ago`} sub="On your cards and loans" />}
          {score && latest && (
            <Line
              glyph="shield"
              hue={score.change > 0 ? 'green' : 'orange'}
              title={`Credit score ${score.change > 0 ? 'up' : 'down'} ${Math.abs(score.change)}, to ${latest.score}`}
              sub={`Since ${formatShortDate(score.since.date)}`}
              onClick={() => nav.present((close) => <CreditSheet onClose={close} />)}
            />
          )}
        </div>
      )}
      {goals.length > 0 && (
        <div class={`group${news ? ' m-after' : ''}`}>
          {progress.map(({ p, mark }) => (
            <GoalLine key={p.goal.id} p={p} mark={mark} onClick={() => nav.present((close) => <GoalEditor goal={p.goal} onClose={close} />)} />
          ))}
        </div>
      )}
    </Part>
  );
}

export function MorningSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const book = useBook();
  const rec = useRecurringModel();
  const { cats } = useSpending();
  const health = useMoneyHealth();
  const todos = useTodos();
  const name = useMeta<string>(GREET_NAME);
  const today = rec.today || todayISO();
  const hour = new Date().getHours();
  const part = dayPart(hour);
  const monday = isMonday(today);

  const fresh = useMemo(() => freshness(txns, today), [txns, today]);
  const stand = useMemo(() => standing(book, today), [book, today]);
  const week = useMemo(() => lastSevenDays(txns, cats, rec.recurring, today), [txns, cats, rec.recurring, today]);
  const ahead = useMemo(() => weekAhead(rec.upcomingItems, today), [rec.upcomingItems, today]);
  const accounts = useMemo(() => new Map(book.accounts.map((a) => [a.id, a])), [book]);

  const go = (to: Tab | Page) => {
    nav.setTab(to);
    props.onClose();
  };
  const importFile = () => nav.present((close) => <ImportFlow onClose={close} />);

  const tiles = (
    [
      {
        key: 'net',
        label: 'Net worth',
        value: whole(stand.netWorth),
        sub: stand.week ? (
          stand.week.total === 0 ? (
            'Same as a week ago'
          ) : (
            <span class={stand.week.total > 0 ? 'pos-text' : 'neg-text'}>
              {stand.week.total > 0 ? '▲' : '▼'} {whole(Math.abs(stand.week.total))} this week
            </span>
          )
        ) : undefined,
        to: 'accounts' as const,
      },
      stand.cash != null && { key: 'cash', label: 'Cash', value: whole(stand.cash), sub: 'Checking & savings', to: 'accounts' as const },
      stand.cards != null && {
        key: 'cards',
        label: 'On cards',
        value: whole(stand.cards),
        sub: stand.cards > 0 ? 'To pay off' : 'Nothing owed',
        to: 'accounts' as const,
        owed: stand.cards > 0,
      },
      health && { key: 'health', label: 'Money Health', value: String(health.score), sub: health.band, to: 'health' as const },
    ] as (Tile | false | null | undefined)[]
  ).filter((t): t is Tile => !!t);

  const moved = (stand.week?.accounts ?? []).filter((c) => Math.abs(c.change) >= ACCOUNT_MOVE).slice(0, 2);
  const usualDiff = week.spent.usual != null ? week.spent.total - week.spent.usual : null;
  const flow = rec.cashFlow;
  const hasAhead = ahead.late.length > 0 || ahead.days.some((d) => d.due.length || d.pay.length);
  const paycheck = flow ? rec.statuses.find((s) => s.rec.kind === 'income' && s.rec.status === 'active') : undefined;

  return (
    <Sheet title="Morning Summary" onClose={props.onClose}>
      <div class="morning">
        <header class="m-hero">
          <span class="m-tag">Your {part === 'morning' ? 'morning' : 'day'}</span>
          <h1 class="m-hello">
            {greeting(hour, name)},<br />
            it’s {weekday(today)}, {formatShortDate(today)}
          </h1>
          {fresh.newest && !fresh.behind && <p class="m-asof">From your bank files through {fresh.newest === today ? 'today' : when(fresh.newest, today)}.</p>}
        </header>

        {fresh.behind && fresh.newest && (
          <div class="callout m-behind">
            <strong>
              <Glyph name="clock" /> Your newest transaction is from {formatShortDate(fresh.newest)}
            </strong>
            <p>Everything here is as of then. Import your latest bank files to bring it up to date.</p>
            <button type="button" class="pill primary" onClick={importFile}>
              Import
            </button>
          </div>
        )}

        {monday && <LastWeekPart today={today} go={go} />}

        <Part id="m-stand" tag="Where you stand" hue="blue">
          <div class={`card m-grid${tiles.length === 1 ? ' single' : ''}`}>
            {tiles.map((t) => (
              <button type="button" class="m-stat" key={t.key} onClick={() => go(t.to)}>
                <span class="m-stat-label">{t.label}</span>
                <span class={`m-stat-value num ${t.owed ? 'neg-text' : ''}`}>{t.value}</span>
                {t.sub && <span class="m-stat-sub">{t.sub}</span>}
              </button>
            ))}
          </div>
        </Part>

        {todos.length > 0 && (
          <Part
            id="m-todo"
            tag="To do"
            hue="orange"
            aside={
              todos.length > TODO_CARDS && (
                <button type="button" class="link" onClick={() => go('home')}>
                  {todos.length - TODO_CARDS} more on Today
                </button>
              )
            }
          >
            <TodoStack items={todos.slice(0, TODO_CARDS)} />
          </Part>
        )}

        <WorthALookPart today={today} />

        <Part id="m-week" tag="The last 7 days" hue="violet">
          <div class="group">
            {stand.week && (
              <Line
                glyph="trend"
                hue={stand.week.total >= 0 ? 'green' : 'red'}
                title={
                  stand.week.total === 0 ? 'Net worth held steady' : `Net worth ${stand.week.total > 0 ? 'up' : 'down'} ${whole(Math.abs(stand.week.total))}`
                }
                sub={
                  stand.week.pct != null && stand.week.total !== 0 ? `${Math.abs(stand.week.pct).toFixed(1)}% since ${formatShortDate(week.from)}` : undefined
                }
              />
            )}
            {moved.map((c) => (
              <Line
                glyph="bank"
                hue="blue"
                title={c.account.name}
                sub={isLiability(c.account) ? `${whole(-c.from)} → ${whole(-c.to)} owed` : `${whole(c.from)} → ${whole(c.to)}`}
                detail={<span class={c.change > 0 ? 'pos-text' : 'neg-text'}>{signed(c.change)}</span>}
              />
            ))}
            {week.income.total > 0 && (
              <Line
                glyph="income"
                hue="green"
                title={`${whole(week.income.total)} came in`}
                sub={week.income.items
                  .slice(0, 2)
                  .map((t) => `${t.payee || t.description}, ${when(t.date, today)}`)
                  .join(' · ')}
              />
            )}
            {!monday && (
              <Line
                glyph="cart"
                hue="orange"
                title={`${whole(week.spent.total)} spent`}
                sub={
                  usualDiff == null || week.spent.usual == null
                    ? undefined
                    : aboutSame(usualDiff, week.spent.usual)
                      ? 'About a usual week'
                      : `${whole(Math.abs(usualDiff))} ${usualDiff > 0 ? 'more' : 'less'} than a usual week (${whole(week.spent.usual)})`
                }
              />
            )}
          </div>
          {week.biggest.length > 0 && (
            <>
              <h3 class="m-sub">Biggest purchases</h3>
              <div class="group">
                {week.biggest.map((t) => (
                  <TransactionRow txn={t} category={cats.get(t.categoryId)} account={accounts.get(t.accountId)} />
                ))}
              </div>
            </>
          )}
        </Part>

        <Part
          id="m-ahead"
          tag="The next 7 days"
          hue="green"
          aside={
            rec.recurring.length > 0 && (
              <button type="button" class="link" onClick={() => go('recurring')}>
                All bills
              </button>
            )
          }
        >
          <div class="card m-days" aria-hidden="true">
            {ahead.days.map((d) => (
              <span class={`m-day${d.date === today ? ' today' : ''}`}>
                <span class="m-day-name">{weekday(d.date, 'narrow')}</span>
                <span class="m-day-num">{Number(d.date.slice(8))}</span>
                <span class="m-day-dots">
                  {d.due.length > 0 && <i class="due" />}
                  {d.pay.length > 0 && <i class="pay" />}
                </span>
              </span>
            ))}
            <span class="m-key">
              <span>
                <i class="due" /> Due
              </span>
              <span>
                <i class="pay" /> Money in
              </span>
            </span>
          </div>
          {rec.recurring.length === 0 ? (
            <button type="button" class="callout m-nudge" onClick={() => go('recurring')}>
              <strong>See your week ahead</strong>
              <p>Confirm your bills and paychecks in Bills &amp; Subscriptions, and what’s due shows here.</p>
            </button>
          ) : hasAhead ? (
            <div class="group">
              {ahead.late.map((i) => (
                <RecurringRow status={i.status} today={today} date={i.date} late category={cats.get(i.status.rec.categoryId ?? '')} />
              ))}
              {ahead.days.flatMap((d) =>
                [...d.pay, ...d.due].map((i) => (
                  <RecurringRow status={i.status} today={today} date={i.date} late={false} category={cats.get(i.status.rec.categoryId ?? '')} />
                )),
              )}
            </div>
          ) : (
            <p class="m-quiet">Nothing due in the next 7 days.</p>
          )}
          {flow && rec.recurring.length > 0 && (
            <p class="section-footer">
              Paycheck {when(flow.payday, today)}
              {paycheck ? ` (+${whole(Math.abs(paycheck.expected))})` : ''}. {whole(flow.bills)} due before then, {whole(flow.cash)} in checking
              {flow.cash >= flow.bills ? ': you’re covered.' : '.'}
            </p>
          )}
        </Part>

        <ThisMonthPart today={today} go={go} />
        <StocksPart today={today} />
        <MilestonesPart today={today} />

        <footer class="m-end">
          <p>{part === 'morning' ? 'That’s your morning. Have a good day.' : 'That’s your day so far.'}</p>
          <button type="button" class="button" onClick={() => go('home')}>
            Go to Today
          </button>
        </footer>
      </div>
    </Sheet>
  );
}
