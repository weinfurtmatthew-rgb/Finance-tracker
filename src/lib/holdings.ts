/**
 * Stocks, ETFs and funds held in an investment account, worked out from your buys and sells and the
 * daily prices (lib/prices.ts).
 *
 * Shares are counted in today's shares (after any splits since), so a split changes nothing here. A
 * dividend is paid on the shares held the day before it goes ex: it buys more shares at that day's close
 * (reinvested, the default) or goes to the account's cash.
 *
 * Without the price service's prices for a ticker (no key yet, or it doesn't have that one), a holding is
 * valued at prices you typed in or paid, or at what you put in when the shares aren't known.
 */
import type { Account, Cents, ISODate, Security, Trade } from '../types';
import { indexOn, splitFactorAfter, type PriceHistory } from './prices';
import { isIra } from './ira';
import { is401k } from './k401';

/** Accounts that can hold stocks, ETFs and funds. */
export const canHoldStocks = (a: Pick<Account, 'type'>) => a.type === 'brokerage' || isIra(a) || is401k(a);

/** Shares bought together: how many are left, and what those cost. */
export interface Lot {
  date: ISODate;
  shares: number;
  cost: Cents;
  /** Bought with a reinvested dividend. */
  dividend?: boolean;
  /** Already held when it was added (an import's start): bought on or before `date`. */
  opening?: boolean;
}

export interface DividendPaid {
  /** The ex-dividend date. */
  date: ISODate;
  /** Per share, in today's shares. */
  perShare: number;
  /** Shares it was paid on. */
  shares: number;
  amount: Cents;
  /** Shares it bought, when reinvested. */
  bought?: number;
}

/** Shares sold from one purchase: when it was bought (on or before, for an import's start), and what they cost. */
export interface SoldPart {
  acquired: ISODate;
  opening?: boolean;
  shares: number;
  cost: Cents;
}

/** A sale, and the purchases it sold (oldest first), with each one's share of what it brought in. */
export interface Sale {
  date: ISODate;
  proceeds: Cents;
  parts: (SoldPart & { proceeds: Cents })[];
}

/** Money into the account's cash (a sale kept there, a dividend paid out), or out of it (a buy from it). */
export interface CashFlow {
  date: ISODate;
  amount: Cents;
}

/** A value that changes on certain days and holds until the next. */
export interface Steps {
  dates: ISODate[];
  values: number[];
}

/** The value on `date` (the latest without one); `before` until the first step. */
export function stepAt(s: Steps, date: ISODate | undefined, before = 0): number {
  if (!s.dates.length) return before;
  if (!date) return s.values[s.values.length - 1];
  const i = indexOn(s.dates, date);
  return i >= 0 ? s.values[i] : before;
}

function setStep(s: Steps, date: ISODate, value: number) {
  const n = s.dates.length;
  if (n && s.dates[n - 1] === date) s.values[n - 1] = value;
  else {
    s.dates.push(date);
    s.values.push(value);
  }
}

/**
 * Where a holding's value comes from: the price service ('market'), prices you typed in or paid
 * ('manual'), or what you put in, when the shares aren't known yet ('cost').
 */
export type PriceSource = 'market' | 'manual' | 'cost';

export interface Position {
  accountId: string;
  ticker: string;
  /** Oldest first. */
  trades: Trade[];
  source: PriceSource;
  /** Shares held now, in today's shares (unknown when valued at cost). */
  shares?: number;
  /** The latest price per share, and the day it's from. */
  price?: number;
  priceDate?: ISODate;
  value: Cents;
  /** What the shares held now cost (the oldest are sold first), reinvested dividends included. */
  cost: Cents;
  gain: Cents;
  /** Dividends received, reinvested or paid out. */
  dividends: Cents;
  paid: DividendPaid[];
  /** Gains (or losses) on shares sold. */
  realized: Cents;
  sales: Sale[];
  lots: Lot[];
  /** Into or out of the account's cash. */
  flows: CashFlow[];
  /** The first trade. */
  first: ISODate;
  /** A sale was bigger than what was held then (only what was held counts). */
  oversold?: boolean;
  /** Shares held over time (what was put in, when valued at cost). */
  steps: Steps;
  history?: PriceHistory;
  /** Prices you typed in or paid, by day (when there's no history). */
  points?: Steps;
}

const EPS = 1e-9;
/** Worked out from the amount, a sale of this much of a holding or more is a sale of all of it (prices move during a day). */
const NEARLY_ALL = 0.98;

/** Oldest first; on one day, in the order they were added (a buy before a sale added at the same moment). */
const byDate = (a: Trade, b: Trade) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt || (a.kind === b.kind ? 0 : a.kind === 'buy' ? -1 : 1);

/** A day's close (or the last before it; the first one, before the history starts), in today's shares. */
function closeFor(h: PriceHistory, date?: ISODate): number {
  if (!date) return h.close[h.close.length - 1];
  return h.close[Math.max(0, indexOn(h.dates, date))];
}

/** A trade's shares in today's shares, when they can be worked out (`history` from the price service). */
export function tradeShares(t: Pick<Trade, 'date' | 'amount' | 'shares'>, history?: PriceHistory): number | undefined {
  const h = history?.dates.length ? history : undefined;
  if (t.shares != null) return t.shares * (h ? splitFactorAfter(h, t.date) : 1);
  return h ? t.amount / 100 / closeFor(h, t.date) : undefined;
}

/** Sells `n` shares, oldest first; returns the purchases they came from. */
function takeLots(lots: Lot[], n: number): SoldPart[] {
  const taken: SoldPart[] = [];
  const from = (lot: Lot) => ({ acquired: lot.date, ...(lot.opening ? { opening: true } : {}) });
  while (n > EPS && lots.length) {
    const lot = lots[0];
    if (lot.shares <= n + EPS) {
      taken.push({ ...from(lot), shares: lot.shares, cost: lot.cost });
      n -= lot.shares;
      lots.shift();
    } else {
      const part = Math.round(lot.cost * (n / lot.shares));
      taken.push({ ...from(lot), shares: n, cost: part });
      lot.cost -= part;
      lot.shares -= n;
      n = 0;
    }
  }
  return taken;
}

/** Prices you paid (trades with shares) and typed in (yours win on the same day), oldest first. */
function pricePoints(trades: Trade[], security?: Security): Steps {
  const byDay = new Map<ISODate, number>();
  for (const t of trades) if (t.shares && t.shares > 0 && t.amount > 0) byDay.set(t.date, t.amount / 100 / t.shares);
  for (const p of security?.manualPrices ?? []) if (p.price > 0) byDay.set(p.date, p.price);
  const days = [...byDay.keys()].sort();
  return { dates: days, values: days.map((d) => byDay.get(d)!) };
}

/** One ticker in one account. */
export function buildPosition(args: {
  accountId: string;
  ticker: string;
  trades: Trade[];
  history?: PriceHistory;
  security?: Security;
  /** Dividends buy more shares (true) or go to the account's cash. */
  reinvest: boolean;
}): Position {
  const trades = [...args.trades].sort(byDate);
  const h = args.history?.dates.length ? args.history : undefined;
  const first = trades[0]?.date ?? '';
  const flows: CashFlow[] = [];
  const steps: Steps = { dates: [], values: [] };
  const base = { accountId: args.accountId, ticker: args.ticker, trades, first, flows, steps, paid: [] as DividendPaid[] };

  // Without prices, buys given only as an amount leave the shares unknown: it's worth what went in.
  const points = h ? undefined : pricePoints(trades, args.security);
  if (!h && (!points!.dates.length || trades.some((t) => t.kind === 'buy' && !(t.shares! > 0)))) {
    let put = 0;
    for (const t of trades) {
      put = t.kind === 'buy' ? put + t.amount : t.all ? 0 : Math.max(0, put - t.amount);
      if (t.cash) flows.push({ date: t.date, amount: t.kind === 'buy' ? -t.amount : t.amount });
      setStep(steps, t.date, put);
    }
    return { ...base, source: 'cost', value: put, cost: put, gain: 0, dividends: 0, realized: 0, sales: [], lots: [] };
  }

  const priceOn = (date: ISODate) => (h ? closeFor(h, date) : stepAt(points!, date, points!.values[0]));
  const divs = h?.dividends ?? [];
  const lots: Lot[] = [];
  const sales: Sale[] = [];
  let shares = 0;
  let dividends = 0;
  let realized = 0;
  let oversold = false;
  let di = 0;
  // Dividends going ex up to `until` (all of them without it), on the shares held before that day's trades.
  const payDividends = (until?: ISODate) => {
    for (; di < divs.length && (until == null || divs[di].date <= until); di++) {
      const d = divs[di];
      const amount = shares > EPS ? Math.round(d.amount * shares * 100) : 0;
      if (amount <= 0) continue;
      dividends += amount;
      if (args.reinvest) {
        const bought = amount / 100 / priceOn(d.date);
        base.paid.push({ date: d.date, perShare: d.amount, shares, amount, bought });
        shares += bought;
        lots.push({ date: d.date, shares: bought, cost: amount, dividend: true });
        setStep(steps, d.date, shares);
      } else {
        base.paid.push({ date: d.date, perShare: d.amount, shares, amount });
        flows.push({ date: d.date, amount });
      }
    }
  };
  for (const t of trades) {
    payDividends(t.date);
    const given = t.shares != null && t.shares > 0 ? t.shares * (h ? splitFactorAfter(h, t.date) : 1) : undefined;
    if (t.kind === 'buy') {
      const n = given ?? t.amount / 100 / priceOn(t.date);
      if (n > 0) {
        shares += n;
        lots.push({ date: t.date, shares: n, cost: t.basis ?? t.amount, ...(t.opening ? { opening: true } : {}) });
      }
      if (t.cash) flows.push({ date: t.date, amount: -t.amount });
    } else {
      let n = t.all ? shares : (given ?? t.amount / 100 / priceOn(t.date));
      if (!t.all && given == null && n >= shares * NEARLY_ALL) n = shares;
      if (n > shares * (1 + 1e-6) + EPS) oversold = true;
      n = Math.min(n, shares);
      const taken = takeLots(lots, n);
      const sold = taken.reduce((s, x) => s + x.shares, 0);
      realized += t.amount - taken.reduce((s, x) => s + x.cost, 0);
      // Each purchase's share of what the sale brought in.
      let left = t.amount;
      const parts = taken.map((x, i) => {
        const proceeds = i === taken.length - 1 ? left : Math.round((t.amount * x.shares) / sold);
        left -= proceeds;
        return { ...x, proceeds };
      });
      if (parts.length) sales.push({ date: t.date, proceeds: t.amount, parts });
      shares -= n;
      if (shares < EPS) shares = 0;
      if (t.cash) flows.push({ date: t.date, amount: t.amount });
    }
    setStep(steps, t.date, shares);
  }
  payDividends();

  const price = h ? closeFor(h) : points!.values[points!.values.length - 1];
  const value = Math.round(shares * price * 100);
  const cost = lots.reduce((s, l) => s + l.cost, 0);
  return {
    ...base,
    source: h ? 'market' : 'manual',
    shares,
    price,
    priceDate: h ? h.dates[h.dates.length - 1] : points!.dates[points!.dates.length - 1],
    value,
    cost,
    gain: value - cost,
    dividends,
    realized,
    sales,
    lots,
    ...(oversold ? { oversold } : {}),
    ...(h ? { history: h } : { points }),
  };
}

/** Shares held at the end of `date` (now without one), in today's shares; undefined when valued at cost. */
export function sharesOn(p: Position, date?: ISODate): number | undefined {
  return p.source === 'cost' ? undefined : stepAt(p.steps, date);
}

/** What a holding was worth at the end of `date` (now without one). */
export function positionValueOn(p: Position, date?: ISODate): Cents {
  if (date && date < p.first) return 0;
  const n = stepAt(p.steps, date);
  if (p.source === 'cost') return Math.round(n);
  if (n <= 0) return 0;
  const price = p.history ? closeFor(p.history, date) : stepAt(p.points!, date, p.points!.values[0]);
  return Math.round(n * price * 100);
}

/**
 * The account's cash over time. With a balance you entered, that's the truth on its day: later flows move
 * it on, earlier ones are undone going back. Without one it starts at nothing. It never goes below zero:
 * a buy from more cash than there was is new money for the rest, and going back, a balance lower than a
 * sale kept as cash means money was taken out. Those come back as `implied` (money in +, out −).
 */
export function cashSteps(flows: CashFlow[], entered?: Account['cash']): { steps: Steps; start: Cents; implied: CashFlow[] } {
  const sorted = [...flows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const steps: Steps = { dates: [], values: [] };
  const implied: CashFlow[] = [];
  let bal = entered?.amount ?? 0;
  let start = 0;
  let i = 0;
  if (entered) {
    const before = sorted.filter((f) => f.date <= entered.date);
    i = before.length;
    const back: [ISODate, Cents][] = [];
    for (let j = before.length - 1; j >= 0; j--) {
      back.push([before[j].date, bal]);
      const raw = bal - before[j].amount;
      if (raw < 0) implied.push({ date: before[j].date, amount: raw });
      bal = Math.max(0, raw);
    }
    start = bal;
    for (let j = back.length - 1; j >= 0; j--) setStep(steps, back[j][0], back[j][1]);
    bal = entered.amount;
  }
  for (; i < sorted.length; i++) {
    const raw = bal + sorted[i].amount;
    if (raw < 0) implied.push({ date: sorted[i].date, amount: -raw });
    bal = Math.max(0, raw);
    setStep(steps, sorted[i].date, bal);
  }
  return { steps, start, implied };
}

export interface Holdings {
  accountId: string;
  /** Biggest first; ones sold off at the end. */
  positions: Position[];
  /** The account's cash over time. */
  cash: Steps;
  cashStart: Cents;
  /** The first trade: before it, the account is worth what you entered for it then, if anything. */
  first: ISODate;
  /**
   * Money put in (+) or taken out (−), oldest first: buys that weren't paid with its cash, sales whose
   * money left it, and what its cash implies. Its cash before the first trade counts as put in that day.
   */
  external: CashFlow[];
}

/** An account's holdings, or undefined when it has no trades. */
export function buildHoldings(account: Account, trades: Trade[], prices: Map<string, PriceHistory>, securities: Map<string, Security>): Holdings | undefined {
  if (!trades.length) return undefined;
  const byTicker = new Map<string, Trade[]>();
  for (const t of trades) {
    const list = byTicker.get(t.ticker);
    if (list) list.push(t);
    else byTicker.set(t.ticker, [t]);
  }
  const paidOut = new Set(account.cashDividends ?? []);
  const positions = [...byTicker].map(([ticker, list]) =>
    buildPosition({
      accountId: account.id,
      ticker,
      trades: list,
      history: prices.get(ticker),
      security: securities.get(ticker),
      reinvest: !paidOut.has(ticker),
    }),
  );
  const held = (p: Position) => (p.source === 'cost' ? p.value > 0 : (p.shares ?? 0) > 0);
  positions.sort((a, b) => Number(held(b)) - Number(held(a)) || b.value - a.value || (a.ticker < b.ticker ? -1 : 1));
  const { steps, start, implied } = cashSteps(
    positions.flatMap((p) => p.flows),
    account.cash,
  );
  const first = trades.reduce((m, t) => (t.date < m ? t.date : m), trades[0].date);
  const external: CashFlow[] = [...implied];
  if (start > 0) external.push({ date: first, amount: start });
  for (const t of trades) if (!t.cash) external.push({ date: t.date, amount: t.kind === 'buy' ? t.amount : -t.amount });
  external.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { accountId: account.id, positions, cash: steps, cashStart: start, first, external };
}

/** Holdings for every investment account that has trades. */
export function buildAllHoldings(accounts: Account[], trades: Trade[], prices: PriceHistory[], securities: Security[]): Map<string, Holdings> {
  const byAccount = new Map<string, Trade[]>();
  for (const t of trades) {
    const list = byAccount.get(t.accountId);
    if (list) list.push(t);
    else byAccount.set(t.accountId, [t]);
  }
  const priceMap = new Map(prices.map((p) => [p.ticker, p]));
  const secMap = new Map(securities.map((s) => [s.ticker, s]));
  const out = new Map<string, Holdings>();
  for (const a of accounts) {
    const list = byAccount.get(a.id);
    if (!list || !canHoldStocks(a)) continue;
    const hs = buildHoldings(a, list, priceMap, secMap);
    if (hs) out.set(a.id, hs);
  }
  return out;
}

export const cashOn = (hs: Holdings, date?: ISODate): Cents => stepAt(hs.cash, date, hs.cashStart);

/** The account's value at the end of `date` (now without one): its holdings and its cash. */
export function holdingsValueOn(hs: Holdings, date?: ISODate): Cents {
  return hs.positions.reduce((s, p) => s + positionValueOn(p, date), 0) + cashOn(hs, date);
}

/** Holdings still held (shares, or money in when valued at cost). */
export const heldPositions = (hs: Holdings) => hs.positions.filter((p) => (p.source === 'cost' ? p.value > 0 : (p.shares ?? 0) > 0));

/** "4.1235", "120", "0.0061": shares to 4 decimal places, or enough to show something. */
export function formatShares(n: number): string {
  if (n === 0) return '0';
  const digits = Math.abs(n) >= 1 ? 4 : Math.min(8, Math.max(4, -Math.floor(Math.log10(Math.abs(n))) + 3));
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** "$242.53", "$0.4912": a price per share, with more digits for small ones. */
export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 4 : 2 });
}

/** Ticker symbols as the price service writes them: "brk.b " → "BRK.B". */
export const normalizeTicker = (text: string) =>
  text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-^/]/g, '');
