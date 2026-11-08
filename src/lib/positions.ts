/**
 * A brokerage's positions file (Fidelity, Schwab, Vanguard and others like them): each holding's shares,
 * value and cost basis, and the cash, as of a day. Importing one into an investment account adds what
 * makes the account match it: the first time, each holding is bought at its value that day (its cost
 * basis kept for gains); later, the differences are bought or sold.
 */
import Papa from 'papaparse';
import type { Cents, ISODate, Trade } from '../types';
import { parseBankDate } from './dates';
import { parseAmount } from './money';
import { normalizeTicker, sharesOn, type Holdings } from './holdings';

export interface PositionRow {
  ticker: string;
  name: string;
  shares: number;
  /** Its market value in the file. */
  value: Cents;
  /** What it cost in total, when the file says. */
  basis?: Cents;
  /** The file's account (its number or name), when it has that column. */
  account: string;
}

export interface PositionsFile {
  format: 'Fidelity' | 'Schwab' | 'Vanguard' | 'Positions';
  rows: PositionRow[];
  /** Cash and money market (the "core" position), by the file's account. */
  cash: Map<string, Cents>;
  /** The file's accounts, in order ('' when it has no account column). */
  accounts: string[];
  /** The day the file says it's from, if it does. */
  asOf?: ISODate;
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');
const SYMBOL = ['symbol', 'ticker', 'symbol/cusip'];
const SHARES = ['quantity', 'qty (quantity)', 'qty', 'shares', 'share quantity'];
const VALUE = ['current value', 'market value', 'mkt val (market value)', 'mkt val', 'total value', 'value'];
const BASIS = ['cost basis total', 'cost basis', 'total cost basis', 'cost basis ($)'];
const NAME = ['description', 'investment name', 'security description', 'name'];
const PRICE = ['last price', 'price', 'share price'];

const number = (text: string) => {
  const n = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** The positions in a file, or null when it isn't a positions file. */
export function readPositions(text: string): PositionsFile | null {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false }).data.map((r) => r.map((c) => (c ?? '').toString()));
  const h = rows.findIndex((r) => {
    const cells = r.map(norm);
    return cells.some((c) => SYMBOL.includes(c)) && cells.some((c) => SHARES.includes(c));
  });
  if (h < 0) return null;
  const head = rows[h].map(norm);
  const col = (names: string[]) => head.findIndex((c) => names.includes(c));
  const at = { symbol: col(SYMBOL), shares: col(SHARES), value: col(VALUE), basis: col(BASIS), name: col(NAME), price: col(PRICE) };
  const accountCol = head.indexOf('account number') >= 0 ? head.indexOf('account number') : head.indexOf('account name');
  const format: PositionsFile['format'] =
    head.includes('percent of account') || head.includes('cost basis total')
      ? 'Fidelity'
      : head.includes('mkt val (market value)') || /^positions for/i.test(rows[0]?.[0] ?? '')
        ? 'Schwab'
        : head.includes('investment name') && head.includes('share price')
          ? 'Vanguard'
          : 'Positions';

  const out: PositionRow[] = [];
  const cash = new Map<string, Cents>();
  const accounts: string[] = [];
  let started = false;
  for (const r of rows.slice(h + 1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    // A blank line ends the positions (Vanguard's file has its transactions after one).
    if (r.every((c) => !c.trim())) {
      if (started) break;
      continue;
    }
    started = true;
    const symbol = cell(at.symbol);
    const name = cell(at.name);
    const account = accountCol >= 0 ? cell(accountCol) : '';
    if (!symbol || /^(account total|total|pending activity)/i.test(symbol)) continue;
    const value = parseAmount(cell(at.value));
    // Cash and money market: Fidelity's core position ("SPAXX**"), Schwab's "Cash & Cash Investments".
    if (/\*\*$/.test(symbol) || /^cash/i.test(symbol) || /money market|cash investments/i.test(name)) {
      if (value != null) cash.set(account, (cash.get(account) ?? 0) + value);
      if (!accounts.includes(account)) accounts.push(account);
      continue;
    }
    // Options ("-SPY261218C500") and bonds by CUSIP aren't tracked.
    if (symbol.startsWith('-') || /^\d/.test(symbol)) continue;
    const shares = number(cell(at.shares));
    if (!(shares > 0)) continue;
    const price = number(cell(at.price));
    const worth = value ?? (price > 0 ? Math.round(shares * price * 100) : null);
    if (worth == null) continue;
    const basis = parseAmount(cell(at.basis));
    out.push({ ticker: normalizeTicker(symbol), name, shares, value: worth, ...(basis != null && basis > 0 ? { basis } : {}), account });
    if (!accounts.includes(account)) accounts.push(account);
  }
  if (!out.length && !cash.size) return null;

  // "as of 10:32 AM ET, 11/08/2026" (Schwab's title) or "Date downloaded Nov-08-2026" (Fidelity's footer).
  const said = rows
    .flat()
    .map((c) => /as of [^,]*,\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(c)?.[1] ?? /date downloaded\s+([A-Za-z]{3}-\d{1,2}-\d{4})/i.exec(c)?.[1])
    .find(Boolean);
  const asOf = said ? parseBankDate(said) : null;
  return { format, rows: out, cash, accounts, ...(asOf ? { asOf } : {}) };
}

export type Change = 'new' | 'more' | 'fewer' | 'gone' | 'same' | 'unknown';

export interface PlannedChange {
  ticker: string;
  name: string;
  change: Change;
  /** Shares in the app that day, and in the file. */
  was: number;
  now: number;
  trade?: Omit<Trade, 'id' | 'createdAt'>;
}

/**
 * What importing `rows` into an account as of `asOf` would add: each holding that's new is bought at its
 * value that day (keeping the file's cost basis), more or fewer shares are bought or sold at that day's
 * price, and (with `sellMissing`) what isn't in the file is sold.
 */
export function planImport(rows: PositionRow[], accountId: string, hs: Holdings | undefined, asOf: ISODate, sellMissing: boolean): PlannedChange[] {
  const base = { accountId, date: asOf, source: 'import' as const };
  const out: PlannedChange[] = [];
  for (const r of rows) {
    const pos = hs?.positions.find((p) => p.ticker === r.ticker);
    // Valued at what went in: its shares aren't known, so they can't be compared.
    if (pos && pos.source === 'cost' && pos.value > 0) {
      out.push({ ticker: r.ticker, name: r.name, change: 'unknown', was: 0, now: r.shares });
      continue;
    }
    const was = pos ? (sharesOn(pos, asOf) ?? 0) : 0;
    const diff = r.shares - was;
    const price = r.value / 100 / r.shares;
    if (Math.abs(diff) < 1e-6 * Math.max(1, r.shares)) {
      out.push({ ticker: r.ticker, name: r.name, change: 'same', was, now: r.shares });
    } else if (was <= 0) {
      out.push({
        ticker: r.ticker,
        name: r.name,
        change: 'new',
        was,
        now: r.shares,
        trade: { ...base, ticker: r.ticker, kind: 'buy', shares: r.shares, amount: r.value, ...(r.basis ? { basis: r.basis } : {}) },
      });
    } else {
      const shares = Math.abs(diff);
      out.push({
        ticker: r.ticker,
        name: r.name,
        change: diff > 0 ? 'more' : 'fewer',
        was,
        now: r.shares,
        trade: {
          ...base,
          ticker: r.ticker,
          kind: diff > 0 ? 'buy' : 'sell',
          shares,
          amount: Math.round(shares * price * 100),
          ...(diff < 0 ? { cash: true } : {}),
        },
      });
    }
  }
  if (sellMissing && hs) {
    for (const p of hs.positions) {
      if (rows.some((r) => r.ticker === p.ticker) || !(p.value > 0)) continue;
      const was = p.source === 'cost' ? 0 : (sharesOn(p, asOf) ?? 0);
      out.push({
        ticker: p.ticker,
        name: '',
        change: 'gone',
        was,
        now: 0,
        trade: { ...base, ticker: p.ticker, kind: 'sell', all: true, amount: p.value, cash: true },
      });
    }
  }
  return out;
}
