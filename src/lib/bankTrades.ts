/**
 * Purchases and sales in an investment account's bank file lines ("YOU BOUGHT PROSPECTUS UNDER SEPARATE
 * COVER FIDELITY 500 INDEX FUND (FXAIX) (Cash)"), so its holdings (lib/holdings.ts) follow them: a periodic
 * investment shows up in the portfolio without typing each one in.
 *
 * A line is a trade when it says it bought or sold, with the money going the right way, and its stock is
 * known: the file's Symbol column, the ticker in parentheses, a ticker the account holds that's named in
 * it, or the one you picked for lines like it. Reinvested dividends aren't trades here (the holdings work
 * those out from the price service's dividends), and neither are money market funds (they're the
 * account's cash) or options.
 *
 * Lines up to the day of the last positions file imported are already counted in it, and a trade you
 * typed in yourself counts as the line's (the same stock, about the same amount, within a few days).
 */
import type { Account, ISODate, Trade, Transaction } from '../types';
import { diffDays } from './dates';
import { canHoldStocks, normalizeTicker } from './holdings';

/** Meta key: the ticker you picked for lines that don't name their stock, by `lineKey`. */
export const LINE_TICKERS = 'lineTickers';

export interface LineTrade {
  kind: 'buy' | 'sell';
  /** From the file's Symbol column, or the line's "(TICKER)". */
  ticker?: string;
  /** The security's name, as the line gives it. */
  name?: string;
  /** It says outright that it's a trade ("YOU BOUGHT", "PERIODIC INVESTMENT"): it counts even without a ticker. */
  plain: boolean;
}

// Lines that start like this are income, reinvested dividends or money moving, not trades.
const NOT_TRADES_START =
  /^(REINVEST\w*|DIVIDENDS?|INTEREST|CAP(ITAL)? GAINS?|LONG-TERM CAP\w*|SHORT-TERM CAP\w*|PURCHASE INTO CORE|REDEMPTION FROM CORE|TRANSFER\w*|ELECTRONIC FUNDS|DIRECT DEPOSIT|CONTRIBUTION|PARTIAL CONTRIBUTION|DISTRIBUTION|FEES?|TAX(ES)?)\b/;
// Nor are lines that say this anywhere: options, the cash (money market) side, card spending.
const NOT_TRADES =
  /\b(OPENING TRANSACTION|CLOSING TRANSACTION|MONEY MARKET|CORE (ACCOUNT|POSITION)|DEBIT CARD|CHECK ?CARD|BILL PAY(MENT)?|DIVIDEND REINVEST\w*)\b/;
const PLAIN_BUY = /\b(YOU BOUGHT|(PERIODIC|AUTOMATIC|AUTO|RECURRING|SYSTEMATIC|SCHEDULED) (INVESTMENT|INVEST|BUY|PURCHASE))\b/;
const PLAIN_SELL = /\bYOU SOLD\b/;
const BUY = /\b(BOUGHT|BUY|PURCHASED?)\b/;
const SELL = /\b(SOLD|SELL|REDEMPTION|REDEEMED)\b/;
/** "(FXAIX)", "(BRK.B)": a ticker in parentheses. Fidelity's "(Cash)" and "(Margin)" aren't. */
const IN_PARENS = /\(([A-Z][A-Z0-9]{0,5}(?:[./][A-Z]{1,2})?)\)/g;
const NOT_TICKERS = new Set(['CASH', 'MARGIN', 'SHORT', 'SHS', 'USD', 'IRA', 'TOD', 'ROTH', 'CUSIP', 'ETF']);
const TICKER = /^[A-Z][A-Z0-9]{0,5}(?:[./][A-Z]{1,2})?$/;
/** A bond's or CD's CUSIP ("912797KX4"): those aren't tracked as holdings. */
const CUSIP = /^(?=.*\d)[0-9A-Z]{9}$/;
/** Money market funds (SPAXX, VMFXX): the account's cash, not a holding. */
export const isMoneyMarket = (ticker: string) => /^[A-Z]{3}XX$/.test(ticker);

/** The ticker a line names: in parentheses, the first that isn't Fidelity's "(Cash)" and the like. */
function tickerIn(description: string): { ticker: string; at: number } | undefined {
  for (const m of description.matchAll(IN_PARENS)) if (!NOT_TICKERS.has(m[1])) return { ticker: m[1], at: m.index ?? 0 };
  return undefined;
}

/**
 * The trade a bank file line is, if it's one: "YOU BOUGHT … (FXAIX)" with money going out is a purchase of
 * FXAIX. `symbol` is the file's Symbol column for the line.
 */
export function readLine(description: string, amount: number, symbol?: string): LineTrade | null {
  const text = description.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text || NOT_TRADES_START.test(text) || NOT_TRADES.test(text)) return null;
  const plainBuy = PLAIN_BUY.test(text);
  const plainSell = PLAIN_SELL.test(text);
  const kind = plainBuy || (!plainSell && BUY.test(text)) ? 'buy' : plainSell || SELL.test(text) ? 'sell' : null;
  if (!kind || (kind === 'buy' ? amount >= 0 : amount <= 0)) return null;
  const fromFile = symbol && !symbol.trim().startsWith('-') ? normalizeTicker(symbol) : '';
  // Bonds and CDs (by CUSIP) aren't tracked as holdings.
  if (CUSIP.test(fromFile) || /\((?=[0-9A-Z]*\d)[0-9A-Z]{9}\)/.test(description)) return null;
  const named = tickerIn(description);
  const ticker = fromFile && TICKER.test(fromFile) ? fromFile : named?.ticker;
  // Buying or selling a money market fund is the account's cash moving.
  if (ticker && isMoneyMarket(ticker)) return null;
  const name = named
    ? description
        .slice(0, named.at)
        .replace(/^\s*(YOU BOUGHT|YOU SOLD|BOUGHT|SOLD|BUY|SELL)\b/i, '')
        .replace(/\b(PROSPECTUS UNDER SEPARATE COVER|(PERIODIC|AUTOMATIC|AUTO|RECURRING|SYSTEMATIC|SCHEDULED) (INVESTMENT|INVEST|BUY|PURCHASE))\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return { kind, ...(ticker ? { ticker } : {}), ...(name ? { name } : {}), plain: plainBuy || plainSell };
}

/** Lines that read the same apart from dates and numbers: "AUTOMATIC INVESTMENT 11/14 REF 4471" → "automatic investment ref". */
export function lineKey(description: string): string {
  return description
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w.replace(/[^a-z&]/g, ''))
    .filter(Boolean)
    .join(' ');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** A ticker the account holds that the line names as a word ("RECURRING BUY VTI"), when just one is. */
function heldTickerIn(description: string, held: string[]): string | undefined {
  const text = ` ${description.toUpperCase()} `;
  const found = held.filter((t) => t.length >= 2 && new RegExp(`[^A-Z0-9.]${escape(t)}[^A-Z0-9.]`).test(text));
  return found.length === 1 ? found[0] : undefined;
}

/** How a line that's a trade stands with the account's holdings. */
export type LineState =
  /** In them, from this line. */
  | 'added'
  /** A trade you typed in yourself is this one. */
  | 'matched'
  /** Counted in the positions file imported for that day or a later one. */
  | 'counted'
  /** You kept it out. */
  | 'kept-out'
  /** Not in them yet. */
  | 'missing';

export interface Line {
  txn: Transaction;
  kind: 'buy' | 'sell';
  /** Unknown when the line doesn't say and you haven't picked one for lines like it. */
  ticker?: string;
  name?: string;
  /** From the file's Quantity column. */
  shares?: number;
  state: LineState;
  /** Its trade, when it's 'added' or 'matched'. */
  trade?: Trade;
}

/** The day the account's holdings were last set from a positions file, if they ever were. */
export function positionsDay(account: Account, trades: Trade[]): ISODate | undefined {
  let day = account.positionsOn;
  for (const t of trades) if (t.accountId === account.id && t.source === 'import' && !t.txnId && (!day || t.date > day)) day = t.date;
  return day;
}

const byDate = (a: Transaction, b: Transaction) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt);

/**
 * The buys and sells in an investment account's bank file lines, oldest first, and how each stands with
 * its holdings. `picked` is the ticker you chose for lines like one (see `LINE_TICKERS`).
 */
export function accountLines(account: Account, txns: Transaction[], trades: Trade[], picked: Record<string, string> = {}): Line[] {
  if (!canHoldStocks(account)) return [];
  // Bank file lines: what you typed in yourself isn't read.
  const mine = txns.filter((t) => t.accountId === account.id && t.source !== 'manual').sort(byDate);
  if (!mine.length) return [];
  const ids = new Set(mine.map((t) => t.id));
  const own = trades.filter((t) => t.accountId === account.id);
  const linked = new Map(own.filter((t) => t.txnId && ids.has(t.txnId)).map((t) => [t.txnId!, t]));
  // Trades a line could be: ones you typed in, and ones whose line is gone (a duplicate of this one, say).
  // A positions file's trades are a day's holdings, not single purchases.
  const free = own.filter((t) => !(t.txnId && ids.has(t.txnId)) && !(t.source === 'import' && !t.txnId));
  const held = [...new Set(own.map((t) => t.ticker))];
  const counted = positionsDay(account, own);
  // The lines that are trades, with their stock where it's known.
  const found: Line[] = [];
  for (const txn of mine) {
    const r = readLine(txn.description, txn.amount, txn.security?.ticker);
    if (!r) continue;
    const ticker = r.ticker ?? heldTickerIn(txn.description, held) ?? picked[lineKey(txn.description)];
    // "Buy" and "sold" alone could be anything: only with a stock named is it surely a trade.
    if (!ticker && !r.plain) continue;
    found.push({
      txn,
      kind: r.kind,
      ...(ticker ? { ticker } : {}),
      ...(r.name ? { name: r.name } : {}),
      ...(txn.security?.shares ? { shares: txn.security.shares } : {}),
      state: 'missing',
    });
  }
  // On one day, purchases before sales. A file doesn't say which came first that day (Fidelity's lists
  // the newest first), and buying first is right either way, since a sale takes the oldest shares; a sale
  // first would find nothing to sell when the shares were bought that morning.
  const rank = (l: Line) => (l.kind === 'buy' ? 0 : 1);
  found.sort((a, b) => (a.txn.date < b.txn.date ? -1 : a.txn.date > b.txn.date ? 1 : rank(a) - rank(b)));
  // Shares to sell from: the holdings' own buys, and the lines' up to that day.
  const boughtBy = (ticker: string, date: ISODate) =>
    own.some((t) => t.ticker === ticker && t.kind === 'buy' && t.date <= date) ||
    found.some((l) => l.ticker === ticker && l.kind === 'buy' && l.txn.date <= date);
  const out: Line[] = [];
  for (const line of found) {
    const { txn } = line;
    const trade = linked.get(txn.id);
    if (trade) out.push({ ...line, state: 'added', trade });
    else if (txn.noTrade) out.push({ ...line, state: 'kept-out' });
    else if (counted && txn.date <= counted) out.push({ ...line, state: 'counted' });
    else {
      const cents = Math.abs(txn.amount);
      const i = line.ticker
        ? free.findIndex(
            (t) =>
              t.ticker === line.ticker &&
              t.kind === line.kind &&
              Math.abs(diffDays(t.date, txn.date)) <= 5 &&
              Math.abs(t.amount - cents) <= Math.max(100, cents / 100),
          )
        : -1;
      if (i >= 0) {
        out.push({ ...line, state: 'matched', trade: free[i] });
        free.splice(i, 1);
      } else if (line.kind === 'sell' && line.ticker && !boughtBy(line.ticker, txn.date)) {
        // A sale of shares from before the holdings start: there's nothing to take them from.
        continue;
      } else out.push(line);
    }
  }
  return out;
}

/** The lines missing from each investment account's holdings (whether or not their stock is known). */
export function missingLines(accounts: Account[], txns: Transaction[], trades: Trade[], picked: Record<string, string> = {}): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  for (const a of accounts) {
    if (a.archived || !canHoldStocks(a)) continue;
    const lines = accountLines(a, txns, trades, picked).filter((l) => l.state === 'missing');
    if (lines.length) out.set(a.id, lines);
  }
  return out;
}

/**
 * The trade for a line: bought on its day for what it cost (the shares from the file when it says), as
 * money put into the account; a sale's money stays in it as cash.
 */
export function tradeFor(line: Line & { ticker: string }, id: string, createdAt: number): Trade {
  return {
    id,
    accountId: line.txn.accountId,
    ticker: line.ticker,
    date: line.txn.date,
    kind: line.kind,
    amount: Math.abs(line.txn.amount),
    ...(line.shares ? { shares: line.shares } : {}),
    ...(line.kind === 'sell' ? { cash: true } : {}),
    source: 'import',
    txnId: line.txn.id,
    createdAt,
  };
}

/**
 * What happens to the trades in the lines an import just added (`added`, their ids). In accounts whose
 * holdings are tracked (they have trades already), the ones missing from them with a known stock go in
 * (`add`). The rest wait for you (`waiting`): an account without holdings yet is yours to start, since its
 * value would become just these, and a line without a stock needs one picked.
 */
export function importedTrades(args: { accounts: Account[]; txns: Transaction[]; trades: Trade[]; added: Set<string>; picked?: Record<string, string> }): {
  add: (Line & { ticker: string })[];
  waiting: Line[];
} {
  const tracked = new Set(args.trades.map((t) => t.accountId));
  const add: (Line & { ticker: string })[] = [];
  const waiting: Line[] = [];
  for (const [accountId, lines] of missingLines(args.accounts, args.txns, args.trades, args.picked)) {
    for (const l of lines) {
      if (!args.added.has(l.txn.id)) continue;
      if (tracked.has(accountId) && l.ticker) add.push(l as Line & { ticker: string });
      else waiting.push(l);
    }
  }
  return { add, waiting };
}

/** "2 purchases of FXAIX", "a sale of VTI", "3 trades of FXAIX and VTI". */
export function tradesText(lines: Line[]): string {
  const n = lines.length;
  const kind = lines.every((l) => l.kind === 'buy') ? 'purchase' : lines.every((l) => l.kind === 'sell') ? 'sale' : 'trade';
  const of = tickersText(lines);
  return `${n === 1 ? 'a' : n} ${kind}${n === 1 ? '' : 's'}${of ? ` of ${of}` : ''}`;
}

/** "FXAIX", "FXAIX and VTI", "FXAIX, VTI and 2 more": the stocks in some lines. */
export function tickersText(lines: { ticker?: string }[]): string {
  const list = [...new Set(lines.map((l) => l.ticker).filter((t): t is string => !!t))];
  if (list.length <= 1) return list[0] ?? '';
  if (list.length <= 3) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
}
