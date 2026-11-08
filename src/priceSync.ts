/**
 * Keeps the prices of what you hold up to date, from Twelve Data with your own free key
 * (lib/twelveData.ts). Only ticker symbols are sent.
 *
 * The free plan allows 8 requests a minute and 800 a day. A ticker's first download takes 3 requests (its
 * closes three ways, to work out splits and dividends: lib/prices.ts); after that, 1 request brings in the
 * latest days. Requests wait their turn to stay under the minute's limit, and stop for the day at the
 * daily one. Prices are checked at most every 4 hours, and not at all while they can't have changed
 * (overnight and at weekends).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, getMeta } from './db';
import { useStore } from './store';
import type { ISODate, Trade } from './types';
import { addDays, todayISO } from './lib/dates';
import { fetchDaily, fetchUsage, PriceError, TWELVE_DATA_KEY, type PriceErrorKind } from './lib/twelveData';
import { historyFrom, historyFromSeries, isFinalBar, mergeRecent, type Bar, type PriceHistory } from './lib/prices';

/** The free plan's limits. Tests raise them: their clock is frozen, so no minute ever passes. */
const FREE = { perMinute: 8, perDay: 800 };
const limits = () => ({ ...FREE, ...(globalThis as { __financePriceLimits?: Partial<typeof FREE> }).__financePriceLimits });

/** Prices are kept this long before checking for newer ones. */
export const REFRESH_MS = 4 * 3600_000;
/** A ticker the price service doesn't have (or the free plan doesn't include) is asked about again after this. */
const RETRY_MISSING_MS = 24 * 3600_000;

/** The last weekday whose market close (22:00 UTC, after settling) has passed. */
export function lastCloseDay(now: number): ISODate {
  for (let back = 0; ; back++) {
    const day = new Date(now - back * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && Date.parse(`${day}T22:00:00Z`) <= now) return day;
  }
}

/** New York's market is open (or settling): 9:30am to about 6pm Eastern, Monday to Friday. */
function inSession(now: number): boolean {
  const d = new Date(now);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && minutes >= 13 * 60 + 30 && minutes < 22 * 60;
}

/** Whether a ticker's prices should be downloaded now (`from`: the first day they're needed). */
export function isDue(h: PriceHistory | undefined, from: ISODate, now: number): boolean {
  if (!h) return true;
  const tried = h.checkedAt ?? h.fetchedAt;
  if (!h.dates.length) return now - tried >= RETRY_MISSING_MS;
  // A trade from before the prices start.
  if (h.from > from) return true;
  if (now - tried < REFRESH_MS) return false;
  const last = h.dates[h.dates.length - 1];
  return !(isFinalBar(last, h.fetchedAt) && last >= lastCloseDay(now) && !inSession(now));
}

export interface PriceSyncState {
  running: boolean;
  /** Requests used today (the price service's day, in UTC), counted on this phone. */
  used: number;
  /** What stopped the last update (a key it didn't accept, the limit, no connection). */
  error?: { kind: PriceErrorKind; message: string };
  /** When an update last finished. */
  lastRun?: number;
}

// Today's count is kept in this browser (not the database: it changes with every request).
const CREDITS = 'financePriceCredits';
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Kept here too, in case the browser won't store it. */
let counted = { day: '', used: 0 };

function readUsed(): number {
  const day = utcDay();
  try {
    const c = JSON.parse(localStorage.getItem(CREDITS) ?? 'null');
    if (c?.day === day && Number.isFinite(c.used)) return Math.max(c.used, counted.day === day ? counted.used : 0);
  } catch {
    // Storage blocked: counted for this visit only.
  }
  return counted.day === day ? counted.used : 0;
}

function writeUsed(used: number) {
  counted = { day: utcDay(), used };
  try {
    localStorage.setItem(CREDITS, JSON.stringify(counted));
  } catch {
    // As above.
  }
  setState({ used });
}

let state: PriceSyncState = { running: false, used: 0 };
const listeners = new Set<(s: PriceSyncState) => void>();
function setState(patch: Partial<PriceSyncState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

/** How updating prices is going, for Settings. */
export function usePriceSync(): PriceSyncState {
  const [s, set] = useState(() => ({ ...state, used: readUsed() }));
  useEffect(() => {
    listeners.add(set);
    set({ ...state, used: readUsed() });
    return () => void listeners.delete(set);
  }, []);
  return s;
}

const sent: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for a request's turn under the minute's limit, and counts it (or stops at the day's). */
async function spend(): Promise<void> {
  const { perMinute, perDay } = limits();
  for (;;) {
    if (readUsed() >= perDay) throw new PriceError('limit', 'day');
    const now = Date.now();
    while (sent.length && now - sent[0] >= 60_000) sent.shift();
    if (sent.length < perMinute) break;
    await sleep(60_000 - (now - sent[0]) + 100);
  }
  sent.push(Date.now());
  writeUsed(readUsed() + 1);
}

/** A request, after waiting its turn. A "too many this minute" reply waits a minute and tries once more. */
async function request<T>(go: () => Promise<T>): Promise<T> {
  await spend();
  try {
    return await go();
  } catch (e) {
    if (!(e instanceof PriceError && e.kind === 'limit')) throw e;
    if (!/minute/i.test(e.message)) {
      writeUsed(Math.max(readUsed(), limits().perDay));
      throw e;
    }
    await sleep(61_000);
    await spend();
    return go();
  }
}

/** Checks a key (1 request) and sets today's count from the price service's own. */
export async function testKey(key: string): Promise<void> {
  const usage = await request(() => fetchUsage(key));
  if (usage.used != null) writeUsed(Math.max(readUsed(), usage.used));
  if (refusedKey === key) refusedKey = undefined;
  setState({ error: undefined });
}

/** Each ticker you've traded, and its first trade. */
function firstTrades(trades: Trade[]): Map<string, ISODate> {
  const first = new Map<string, ISODate>();
  for (const t of trades) {
    const f = first.get(t.ticker);
    if (!f || t.date < f) first.set(t.ticker, t.date);
  }
  return first;
}

/** Every day since `from`: one request brings about 20 years, so a purchase from before then takes more. */
async function fetchSince(ticker: string, from: ISODate, key: string, adjust: 'none' | 'splits' | 'all') {
  const bars: Bar[] = [];
  for (let start = from; ; ) {
    const page = await request(() => fetchDaily(ticker, start, key, adjust));
    for (const b of page.bars) if (!bars.length || b.date > bars[bars.length - 1].date) bars.push(b);
    if (!page.more || !page.bars.length) return { bars, meta: page.meta };
    start = addDays(page.bars[page.bars.length - 1].date, 1);
  }
}

async function update(ticker: string, from: ISODate, h: PriceHistory | undefined, key: string): Promise<void> {
  if (h?.dates.length && h.from <= from) {
    // The latest days, adjusted for everything, checked against the days already here.
    let last = h.dates.length - 1;
    if (!isFinalBar(h.dates[last], h.fetchedAt)) last--;
    if (last >= 0) {
      const { bars } = await request(() => fetchDaily(ticker, addDays(h.dates[last], -10), key, 'all'));
      const merged = mergeRecent(h, bars, Date.now());
      if (merged) {
        await db.priceCache.put({ ...merged, checkedAt: Date.now() });
        return;
      }
    }
  }
  // Everything since `from`, three ways (a split or dividend since rescales every earlier close).
  const raw = await fetchSince(ticker, from, key, 'none');
  const split = await fetchSince(ticker, from, key, 'splits');
  const all = await fetchSince(ticker, from, key, 'all');
  const at = Date.now();
  const next = historyFromSeries(ticker, { raw: raw.bars, splitAdjusted: split.bars, all: all.bars }, { from, fetchedAt: at, ...split.meta });
  await db.priceCache.put({ ...next, checkedAt: at });
  const security = await db.securities.get(ticker);
  if (next.type && security && !security.type) await db.securities.update(ticker, { type: next.type });
}

/** A ticker the price service couldn't send: kept with the reason, so it's not asked about again for a while. */
async function markMissing(ticker: string, from: ISODate, h: PriceHistory | undefined, kind: PriceErrorKind) {
  const at = Date.now();
  await db.priceCache.put(
    h?.dates.length
      ? { ...h, checkedAt: at, error: kind }
      : { ticker, dates: [], close: [], total: [], splits: [], dividends: [], from, fetchedAt: 0, checkedAt: at, error: kind },
  );
}

/** A key the price service turned down: not tried again on its own (only when it changes, or you ask). */
let refusedKey: string | undefined;

async function run(force: boolean): Promise<void> {
  const key = (await getMeta<string>(TWELVE_DATA_KEY))?.trim();
  if (!key || (!force && key === refusedKey)) return;
  const first = firstTrades(await db.trades.toArray());
  const cached = new Map((await db.priceCache.toArray()).map((h) => [h.ticker, h]));
  const today = todayISO();
  const now = Date.now();
  // Prices of tickers no longer held anywhere go (not ones just downloaded for a trade being added).
  const gone = [...cached.values()].filter((h) => !first.has(h.ticker) && now - (h.checkedAt ?? h.fetchedAt) > 3600_000).map((h) => h.ticker);
  if (gone.length) await db.priceCache.bulkDelete(gone);
  const jobs = [...first]
    .map(([ticker, day]) => ({ ticker, from: historyFrom(day, today), h: cached.get(ticker) }))
    .filter((j) => force || isDue(j.h, j.from, now))
    // Never downloaded first, then the longest since.
    .sort((a, b) => (a.h?.checkedAt ?? 0) - (b.h?.checkedAt ?? 0));
  if (!jobs.length) return;
  setState({ running: true });
  let error: PriceSyncState['error'];
  for (const j of jobs) {
    try {
      await update(j.ticker, j.from, j.h, key);
    } catch (e) {
      const kind: PriceErrorKind = e instanceof PriceError ? e.kind : 'other';
      // A problem with one ticker; anything else stops the rest too.
      if (kind === 'symbol' || kind === 'plan' || kind === 'other') await markMissing(j.ticker, j.from, j.h, kind);
      else {
        error = { kind, message: (e as Error).message };
        if (kind === 'key') refusedKey = key;
        break;
      }
    }
  }
  setState({ running: false, lastRun: Date.now(), error });
}

/**
 * A ticker's prices back to `date`, ahead of a trade there being saved, so the sheet can show the shares
 * it comes to. Does nothing when they're already here (or known to be missing).
 */
export async function pricesFor(ticker: string, date: ISODate): Promise<void> {
  const key = (await getMeta<string>(TWELVE_DATA_KEY))?.trim();
  if (!key || key === refusedKey) return;
  if (current) await current;
  const earliest = (await db.trades.where('ticker').equals(ticker).toArray()).reduce((m, t) => (t.date < m ? t.date : m), date);
  const from = historyFrom(earliest, todayISO());
  const h = await db.priceCache.get(ticker);
  if (h && (h.dates.length ? h.from <= from : Date.now() - (h.checkedAt ?? 0) < RETRY_MISSING_MS)) return;
  try {
    await update(ticker, from, h, key);
  } catch (e) {
    const kind: PriceErrorKind = e instanceof PriceError ? e.kind : 'other';
    if (kind === 'symbol' || kind === 'plan' || kind === 'other') await markMissing(ticker, from, h, kind);
    else if (kind === 'key') refusedKey = key;
  }
}

let current: Promise<void> | null = null;
let queued: { force: boolean } | null = null;

/** Brings prices up to date. While an update runs, another one follows it (trades may have changed). */
export function syncPrices(opts: { force?: boolean } = {}): Promise<void> {
  if (current) {
    queued = { force: !!opts.force || !!queued?.force };
    return current;
  }
  current = run(!!opts.force)
    .catch((e) => setState({ running: false, error: { kind: 'other', message: String((e as Error)?.message ?? e) } }))
    .finally(() => {
      current = null;
      const next = queued;
      queued = null;
      if (next) void syncPrices(next);
    });
  return current;
}

/** Updates prices while the app is open: when what you hold or the key changes, every 15 minutes, and on coming back to it. */
export function usePriceUpdates(active: boolean) {
  const s = useStore();
  const key = s.meta?.get(TWELVE_DATA_KEY) as string | undefined;
  const trades = s.raw.trades;
  // Only a new ticker, or an earlier first trade, needs new prices.
  const what = useMemo(
    () =>
      trades
        ? [...firstTrades(trades)]
            .map(([t, d]) => `${t}:${d}`)
            .sort()
            .join(',')
        : '',
    [trades],
  );
  useEffect(() => {
    if (!active || !key || !what) return;
    const id = setTimeout(() => void syncPrices(), 600);
    return () => clearTimeout(id);
  }, [active, key, what]);
  useEffect(() => {
    if (!active || !key) return;
    const check = () => document.visibilityState === 'visible' && void syncPrices();
    const id = setInterval(check, 15 * 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active, key]);
}
