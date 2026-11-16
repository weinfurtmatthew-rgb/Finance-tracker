/**
 * The morning summary: one page with where you stand, what to do, what changed in the last 7 days and
 * what's coming in the next 7 (lib/morning.ts). It opens by itself the first time you open the app on a
 * morning (app.tsx), and from the sun button on Today any time.
 */
import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { useNav, type Page, type Tab } from '../nav';
import { useBook, useMeta, useTransactions } from '../hooks';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { useMoneyHealth } from '../healthModel';
import { useTodos, type Todo } from '../todoModel';
import { dayPart, freshness, greeting, lastSevenDays, standing, weekAhead } from '../lib/morning';
import { formatMoney } from '../lib/money';
import { isLiability } from '../lib/balances';
import { diffDays, formatShortDate, todayISO } from '../lib/dates';
import { Glyph, IconChip, type GlyphName, type Hue } from '../components/icons';
import { Sheet } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { RecurringRow } from '../components/RecurringRow';
import { ImportFlow } from '../lazy';

/** The meta key holding the day it last opened by itself. */
export const MORNING_SEEN = 'morningSeen';
/** An optional first name for the greeting (Settings → Appearance). */
export const GREET_NAME = 'greetName';

/** How many To do items show as cards (the rest are on Today). */
const TODO_CARDS = 3;
/** An account that moved at least this much in the 7 days gets a line. */
const ACCOUNT_MOVE = 100_00;

const whole = (c: number) => formatMoney(c, { whole: true });
const signed = (c: number) => `${c >= 0 ? '+' : '−'}${whole(Math.abs(c))}`;

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

/** One line in a list: an icon, what happened, and an amount. */
function Line(props: { glyph: GlyphName; hue: Hue; title: ComponentChildren; sub?: ComponentChildren; detail?: ComponentChildren }) {
  return (
    <div class="row m-line">
      <IconChip name={props.glyph} hue={props.hue} size="sm" />
      <span class="row-main">
        <span class="row-title">{props.title}</span>
        {props.sub && <span class="row-subtitle wrap">{props.sub}</span>}
      </span>
      {props.detail != null && <span class="row-detail">{props.detail}</span>}
    </div>
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

        <Part id="m-stand" tag="Where you stand" hue="blue">
          <div class="card m-grid">
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
            <Line
              glyph="cart"
              hue="orange"
              title={`${whole(week.spent.total)} spent`}
              sub={
                usualDiff == null || week.spent.usual == null
                  ? undefined
                  : Math.abs(usualDiff) <= Math.max(25_00, week.spent.usual * 0.1)
                    ? 'About a usual week'
                    : `${whole(Math.abs(usualDiff))} ${usualDiff > 0 ? 'more' : 'less'} than a usual week (${whole(week.spent.usual)})`
              }
            />
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
