/**
 * The morning summary (screens/Morning.tsx): how you stand, what changed in the last 7 days and what's
 * coming in the next 7, from the same data and the same rules as the rest of the app (spending as
 * lib/spend.ts counts it, balances as lib/networth.ts does). Pure functions, so they're easy to test.
 */
import type { Category, Cents, ISODate, Recurring, Transaction } from '../types';
import { addDays, diffDays } from './dates';
import { lines } from './lines';
import { balanceOn, changeSince, historyStart, netWorthOn, type AccountChange, type BalanceBook } from './networth';
import { isOutflow, type UpcomingItem } from './recurring';
import { lineKinds } from './spend';

// ---------------------------------------------------------------------------------------------
// When it opens, and how it greets you
// ---------------------------------------------------------------------------------------------

/** It opens by itself on the first open of a day between these hours (local time). */
export const MORNING_FROM = 4;
export const MORNING_UNTIL = 12;

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Before 4 a.m. still counts as the evening before. */
export const dayPart = (hour: number): DayPart =>
  hour >= MORNING_FROM && hour < MORNING_UNTIL ? 'morning' : hour >= MORNING_UNTIL && hour < 17 ? 'afternoon' : 'evening';

/** Once a day, in the morning, when there's something to sum up. */
export function opensNow(args: { hour: number; today: ISODate; seen?: ISODate; hasData: boolean }): boolean {
  return args.hasData && dayPart(args.hour) === 'morning' && args.seen !== args.today;
}

/** "Good morning, Sam" (or without a name). */
export function greeting(hour: number, name?: string): string {
  const hello = `Good ${dayPart(hour)}`;
  const n = name?.trim();
  return n ? `${hello}, ${n}` : hello;
}

// ---------------------------------------------------------------------------------------------
// How up to date the numbers are: everything comes from bank files you import
// ---------------------------------------------------------------------------------------------

/** Older than this, the summary says an import would bring it up to date. */
export const BEHIND_DAYS = 3;

export interface Freshness {
  /** The newest transaction dated up to today. */
  newest?: ISODate;
  /** Days from it to today. */
  age?: number;
  behind: boolean;
}

export function freshness(txns: Transaction[], today: ISODate): Freshness {
  let newest: ISODate | undefined;
  for (const t of txns) if (t.date <= today && (!newest || t.date > newest)) newest = t.date;
  if (!newest) return { behind: false };
  const age = diffDays(newest, today);
  return { newest, age, behind: age > BEHIND_DAYS };
}

// ---------------------------------------------------------------------------------------------
// Where you stand
// ---------------------------------------------------------------------------------------------

const CASH_TYPES = new Set(['checking', 'savings', 'cash', 'wallet']);

export interface Standing {
  netWorth: Cents;
  /** Over the last 7 days (null when the history doesn't go back that far). */
  week: { total: Cents; pct: number | null; accounts: AccountChange[] } | null;
  /** Checking, savings and cash (null without any of those accounts). */
  cash: Cents | null;
  /** Owed on credit cards, as a positive number (null without a card). */
  cards: Cents | null;
}

export function standing(book: BalanceBook, today: ISODate): Standing {
  const open = book.accounts.filter((a) => !a.archived);
  const sum = (match: (type: string) => boolean) => {
    const list = open.filter((a) => match(a.type));
    return list.length ? list.reduce((s, a) => s + balanceOn(book, a), 0) : null;
  };
  const cardBalance = sum((t) => t === 'credit');
  const weekAgo = addDays(today, -7);
  const start = historyStart(book);
  return {
    netWorth: netWorthOn(book).net,
    week: start && start <= weekAgo ? changeSince(book, weekAgo) : null,
    cash: sum((t) => CASH_TYPES.has(t)),
    cards: cardBalance == null ? null : -cardBalance,
  };
}

// ---------------------------------------------------------------------------------------------
// The last 7 days
// ---------------------------------------------------------------------------------------------

/** A purchase this big makes the list of the week's biggest. */
export const BIG_PURCHASE = 100_00;
/** Weeks before the last 7 days that make a "usual" week (fewer when the history is shorter). */
const USUAL_WEEKS = 8;

export interface LastSevenDays {
  /** The first of the 7 days (the last is today). */
  from: ISODate;
  /** Money that came in (paychecks, interest…), biggest first. */
  income: { total: Cents; items: Transaction[] };
  /** Spent in the 7 days (Spending's rule: purchases minus refunds), and in a usual 7 days before them. */
  spent: { total: Cents; usual: Cents | null };
  /** The biggest purchases, up to 3. */
  biggest: Transaction[];
}

export function lastSevenDays(txns: Transaction[], categories: Map<string, Category>, recurring: Recurring[], today: ISODate): LastSevenDays {
  const from = addDays(today, -6);
  const usualFrom = addDays(from, -7 * USUAL_WEEKS);
  const { kind } = lineKinds(categories, recurring);
  let first: ISODate | undefined;
  let spent = 0;
  let before = 0;
  let income = 0;
  const incomeItems = new Map<string, Transaction>();
  const purchases = new Map<string, Transaction>();
  for (const t of txns) if (t.date <= today && (!first || t.date < first)) first = t.date;
  for (const line of lines(txns)) {
    if (line.date > today || line.date < usualFrom) continue;
    const k = kind(line);
    const inWeek = line.date >= from;
    if (k === 'income') {
      if (inWeek && line.amount > 0) {
        income += line.amount;
        incomeItems.set(line.id, txns.find((t) => t.id === line.id) ?? line);
      }
      continue;
    }
    if (k !== 'everyday' && k !== 'bills') continue;
    if (inWeek) {
      spent -= line.amount;
      if (line.amount < 0) purchases.set(line.id, txns.find((t) => t.id === line.id) ?? line);
    } else before -= line.amount;
  }
  // A usual week: the weeks before these 7 days that the history covers in full.
  const weeks = first ? Math.min(USUAL_WEEKS, Math.floor(diffDays(first, from) / 7)) : 0;
  const usualStart = addDays(from, -7 * weeks);
  if (weeks > 0 && weeks < USUAL_WEEKS) {
    // Only the covered weeks count: take out what fell before them.
    before = 0;
    for (const line of lines(txns)) {
      if (line.date < usualStart || line.date >= from) continue;
      const k = kind(line);
      if (k === 'everyday' || k === 'bills') before -= line.amount;
    }
  }
  return {
    from,
    income: { total: income, items: [...incomeItems.values()].sort((a, b) => b.amount - a.amount) },
    spent: { total: spent, usual: weeks >= 2 ? Math.round(before / weeks) : null },
    biggest: [...purchases.values()]
      .filter((t) => -t.amount >= BIG_PURCHASE)
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 3),
  };
}

// ---------------------------------------------------------------------------------------------
// The next 7 days
// ---------------------------------------------------------------------------------------------

export interface AheadDay {
  date: ISODate;
  /** Bills, subscriptions, card payments… due that day. */
  due: UpcomingItem[];
  /** Paychecks and other money expected that day. */
  pay: UpcomingItem[];
}

export interface WeekAhead {
  days: AheadDay[];
  /** Due dates that passed with no matching charge imported yet. */
  late: UpcomingItem[];
  /** Due in the 7 days. */
  dueTotal: Cents;
  /** Expected in. */
  payTotal: Cents;
}

/** Upcoming items (lib/recurring.ts upcoming) laid out over today and the 6 days after it. */
export function weekAhead(items: UpcomingItem[], today: ISODate, length = 7): WeekAhead {
  const days: AheadDay[] = Array.from({ length }, (_, i) => ({ date: addDays(today, i), due: [], pay: [] }));
  const late: UpcomingItem[] = [];
  let dueTotal = 0;
  let payTotal = 0;
  for (const i of items) {
    if (i.late) {
      if (isOutflow(i.status.rec)) late.push(i);
      continue;
    }
    const n = diffDays(today, i.date);
    if (n < 0 || n >= length) continue;
    if (isOutflow(i.status.rec)) {
      days[n].due.push(i);
      dueTotal += Math.abs(i.amount);
    } else {
      days[n].pay.push(i);
      payTotal += Math.abs(i.amount);
    }
  }
  return { days, late, dueTotal, payTotal };
}

// ---------------------------------------------------------------------------------------------
// Mondays: where last week's money went
// ---------------------------------------------------------------------------------------------

const localDate = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const isMonday = (iso: ISODate) => localDate(iso).getDay() === 1;

/** The Monday of the week a date is in. */
export const weekStart = (iso: ISODate) => addDays(iso, -((localDate(iso).getDay() + 6) % 7));

export interface LastWeek {
  /** Monday… */
  from: ISODate;
  /** …through Sunday. */
  to: ISODate;
  total: Cents;
  /** A usual week before it (up to 8 weeks the history covers in full; null with fewer than 2). */
  usual: Cents | null;
  /** Spent by category, biggest first (refunds taken off; none at or under zero). */
  categories: { categoryId: string; amount: Cents }[];
  /** Where it went, by place, biggest first (up to 3). */
  places: { name: string; amount: Cents; count: number }[];
}

/** Monday through Sunday of the week before `today`'s, by Spending's rule. */
export function lastWeek(txns: Transaction[], categories: Map<string, Category>, recurring: Recurring[], today: ISODate): LastWeek {
  const from = addDays(weekStart(today), -7);
  const to = addDays(from, 6);
  const { kind } = lineKinds(categories, recurring);
  let first: ISODate | undefined;
  for (const t of txns) if (t.date <= today && (!first || t.date < first)) first = t.date;
  const weeks = first ? Math.min(USUAL_WEEKS, Math.floor(diffDays(first, from) / 7)) : 0;
  const usualFrom = addDays(from, -7 * weeks);
  const byCategory = new Map<string, Cents>();
  const byPlace = new Map<string, { name: string; amount: Cents; ids: Set<string> }>();
  let total = 0;
  let before = 0;
  for (const line of lines(txns)) {
    if (line.date > to || line.date < usualFrom) continue;
    const k = kind(line);
    if (k !== 'everyday' && k !== 'bills') continue;
    if (line.date < from) {
      before -= line.amount;
      continue;
    }
    total -= line.amount;
    byCategory.set(line.categoryId, (byCategory.get(line.categoryId) ?? 0) - line.amount);
    const name = (line.payee || line.description).trim();
    const key = name.toLowerCase();
    const p = byPlace.get(key) ?? { name, amount: 0, ids: new Set<string>() };
    p.amount -= line.amount;
    p.ids.add(line.id);
    byPlace.set(key, p);
  }
  return {
    from,
    to,
    total,
    usual: weeks >= 2 ? Math.round(before / weeks) : null,
    categories: [...byCategory]
      .filter(([, amount]) => amount > 0)
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .sort((a, b) => b.amount - a.amount),
    places: [...byPlace.values()]
      .filter((p) => p.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((p) => ({ name: p.name, amount: p.amount, count: p.ids.size })),
  };
}

// ---------------------------------------------------------------------------------------------
// Worth a look: charges from the last 7 days that stand out
// ---------------------------------------------------------------------------------------------

/** The same charge twice this close together (and at least this much) might be a double charge. */
export const DOUBLE_MIN = 15_00;
/** At least this many times what that place usually costs (and this much more) is unusual. */
const UNUSUAL_TIMES = 2;
const UNUSUAL_MORE = 30_00;
/** A first visit this big is worth a look… */
const NEW_PLACE_MIN = 100_00;
/** …once the history is long enough for "first" to mean something. */
const NEW_PLACE_HISTORY_DAYS = 60;
/** Fees by name (late, overdraft, returned…), besides the Fees category. */
const FEE = /\b(late (fee|charge|payment)|overdraft|nsf|returned (item|payment)|service charge|maintenance fee|foreign transaction fee|atm fee)\b/i;

export type LookKind = 'double' | 'fee' | 'unusual' | 'new';

export interface WorthALook {
  key: string;
  kind: LookKind;
  txn: Transaction;
  /** The other charge, for a possible double charge. */
  other?: Transaction;
  /** What that place usually costs (median), for an unusual charge. */
  usual?: Cents;
}

const placeOf = (t: Transaction) => (t.payee || t.description).trim().toLowerCase();

/** Charges from the last 7 days that stand out, the likeliest mistakes first. */
export function worthALook(txns: Transaction[], categories: Map<string, Category>, today: ISODate): WorthALook[] {
  const from = addDays(today, -6);
  const isPurchase = (t: Transaction) => t.amount < 0 && categories.get(t.categoryId)?.group === 'expense';
  let first: ISODate | undefined;
  for (const t of txns) if (t.date <= today && (!first || t.date < first)) first = t.date;
  const history = new Map<string, Transaction[]>();
  for (const t of txns) if (t.date <= today && isPurchase(t)) (history.get(placeOf(t)) ?? history.set(placeOf(t), []).get(placeOf(t))!).push(t);

  const out: WorthALook[] = [];
  const doubled = new Set<string>();
  for (const t of txns) {
    if (t.date < from || t.date > today || t.amount >= 0) continue;
    const place = placeOf(t);
    if (t.categoryId === 'fees' || FEE.test(`${t.description} ${t.payee}`)) {
      out.push({ key: `fee:${t.id}`, kind: 'fee', txn: t });
      continue;
    }
    if (!isPurchase(t)) continue;
    const seen = history.get(place) ?? [];
    const twin = seen.find((o) => o.id !== t.id && o.amount === t.amount && Math.abs(diffDays(o.date, t.date)) <= 1 && !doubled.has(o.id));
    if (twin && -t.amount >= DOUBLE_MIN) {
      doubled.add(t.id);
      doubled.add(twin.id);
      const [a, b] = twin.date < t.date || (twin.date === t.date && twin.id < t.id) ? [twin, t] : [t, twin];
      out.push({ key: `double:${a.id}:${b.id}`, kind: 'double', txn: b, other: a });
      continue;
    }
    if (doubled.has(t.id)) continue;
    const earlier = seen.filter((o) => o.date < t.date);
    if (earlier.length >= 3) {
      const amounts = earlier.map((o) => -o.amount).sort((x, y) => x - y);
      const mid = amounts[Math.floor(amounts.length / 2)];
      if (-t.amount >= mid * UNUSUAL_TIMES && -t.amount - mid >= UNUSUAL_MORE) out.push({ key: `unusual:${t.id}`, kind: 'unusual', txn: t, usual: mid });
    } else if (earlier.length === 0 && -t.amount >= NEW_PLACE_MIN && first && diffDays(first, t.date) >= NEW_PLACE_HISTORY_DAYS) {
      out.push({ key: `new:${t.id}`, kind: 'new', txn: t });
    }
  }
  const order: Record<LookKind, number> = { double: 0, fee: 1, unusual: 2, new: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.txn.amount - b.txn.amount);
}

// ---------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------

/**
 * Net worth reached a new high this week: today's is above every day before the last 7, and no day in
 * them was higher (a dip since the peak isn't a high). Needs at least 3 months of history to mean much.
 */
export function netWorthHigh(book: BalanceBook, today: ISODate): boolean {
  const start = historyStart(book);
  if (!start || diffDays(start, today) < 90) return false;
  const now = netWorthOn(book).net;
  if (now <= 0) return false;
  const weekAgo = addDays(today, -7);
  for (let d = addDays(weekAgo, 1); d < today; d = addDays(d, 1)) if (netWorthOn(book, d).net > now) return false;
  for (let d = start; d <= weekAgo; d = addDays(d, 1)) if (netWorthOn(book, d).net >= now) return false;
  return true;
}

/** How much less you owe on cards and loans than on `since` (0 when it went up). */
export function debtPaidDown(book: BalanceBook, since: ISODate): Cents {
  let paid = 0;
  for (const a of book.accounts) {
    if (a.archived || (a.type !== 'credit' && a.type !== 'loan')) continue;
    paid += balanceOn(book, a) - balanceOn(book, a, since);
  }
  return Math.max(0, paid);
}

/** How far toward a goal its account got in the last 7 days: the quarter mark it passed (100 is reached), if any. */
export function goalMilestone(book: BalanceBook, goal: { accountId: string; target: Cents }, today: ISODate): 25 | 50 | 75 | 100 | null {
  const account = book.accounts.find((a) => a.id === goal.accountId);
  if (!account || goal.target <= 0) return null;
  const quarter = (saved: Cents) => Math.min(4, Math.floor((Math.max(0, saved) / goal.target) * 4));
  const now = quarter(balanceOn(book, account));
  const then = quarter(balanceOn(book, account, addDays(today, -7)));
  return now > then ? ((now * 25) as 25 | 50 | 75 | 100) : null;
}

// ---------------------------------------------------------------------------------------------
// The "burst": circles for where the money went
// ---------------------------------------------------------------------------------------------

export interface Bubble {
  x: number;
  y: number;
  r: number;
}

/** Circles that touch overlap by this much of their two radii (and no two overlap more). */
const TOUCH = 0.86;
/** Going up or down from the middle costs this much more than going sideways: the space is wide. */
const WIDE = 1.8;

/**
 * Circles for some amounts, biggest first, packed into a cluster: each circle's area goes with its amount,
 * the biggest is placed first, and each next one goes where it's closest to the middle while only slightly
 * overlapping the others (so the small ones settle in the gaps between the big ones). Scaled down together
 * to fit `width`; `height` is what they take up.
 */
export function burstLayout(amounts: number[], width = 340, maxD = 128, minD = 30): { bubbles: Bubble[]; height: number } {
  const top = Math.max(0, ...amounts);
  if (!amounts.length || top <= 0) return { bubbles: [], height: 0 };
  const r = amounts.map((a) => Math.max(minD, maxD * Math.sqrt(Math.max(0, a) / top)) / 2);
  const at = [{ x: 0, y: 0 }];
  for (let i = 1; i < r.length; i++) {
    let best: { x: number; y: number; score: number } | undefined;
    // Every spot touching a circle already placed, every 5 degrees around it.
    for (let j = 0; j < i; j++) {
      const d = (r[j] + r[i]) * TOUCH;
      for (let step = 0; step < 72; step++) {
        const angle = (step * Math.PI) / 36;
        const x = at[j].x + d * Math.cos(angle);
        const y = at[j].y + d * Math.sin(angle);
        if (at.some((p, k) => k !== j && Math.hypot(p.x - x, p.y - y) < (r[k] + r[i]) * TOUCH - 1e-6)) continue;
        const score = x * x + (y * WIDE) ** 2;
        if (!best || score < best.score - 1e-6) best = { x, y, score };
      }
    }
    at.push(best ?? { x: Math.max(...at.map((p, k) => p.x + r[k])) + r[i], y: 0 });
  }
  const minX = Math.min(...at.map((p, i) => p.x - r[i]));
  const maxX = Math.max(...at.map((p, i) => p.x + r[i]));
  const minY = Math.min(...at.map((p, i) => p.y - r[i]));
  const maxY = Math.max(...at.map((p, i) => p.y + r[i]));
  // Room for the rings around the circles.
  const pad = 4;
  const scale = Math.min(1, (width - 2 * pad) / (maxX - minX));
  const left0 = (width - (maxX - minX) * scale) / 2;
  return {
    bubbles: at.map((p, i) => ({ x: left0 + (p.x - minX) * scale, y: pad + (p.y - minY) * scale, r: r[i] * scale })),
    height: (maxY - minY) * scale + 2 * pad,
  };
}
