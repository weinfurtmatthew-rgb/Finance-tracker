/**
 * Today's news about your biggest stock holdings, for the morning summary (lib/news.ts): headlines from
 * Alpha Vantage with your own free key, and company announcements from Twelve Data with your price key.
 * Each company is asked about once a day, when the summary opens, and what comes back is kept in this
 * browser for the rest of the day. Only ticker symbols are sent.
 *
 * Alpha Vantage's free plan allows 25 requests a day: news for up to 6 companies leaves room. Its requests
 * are spaced out (5 a minute) and stop for the day at the limit. Announcements take 1 Twelve Data request
 * a company a day, counted with the price requests (priceSync.ts).
 */
import { useEffect, useState } from 'preact/hooks';
import type { ISODate } from './types';
import { useMeta } from './hooks';
import { addDays } from './lib/dates';
import { ANNOUNCEMENTS, announcementsFrom, headlinesFrom, NEWS_DAYS, NEWS_KEY, NewsError, type NewsErrorKind, type NewsItem } from './lib/news';
import { fetchHeadlines } from './lib/alphaVantage';
import { PriceError, TWELVE_DATA_KEY } from './lib/twelveData';
import { announcementsSince } from './priceSync';

/** Alpha Vantage's free plan. Tests raise them: their clock is frozen, so no minute ever passes. */
const FREE = { perMinute: 5, perDay: 25 };
const limits = () => ({ ...FREE, ...(globalThis as { __financeNewsLimits?: Partial<typeof FREE> }).__financeNewsLimits });

type Source = 'headlines' | 'announcements';

/** What stopped a source: for the day, except no connection, which is tried again after a few minutes. */
interface Stop {
  kind: NewsErrorKind;
  at: number;
}
const RETRY_OFFLINE_MS = 10 * 60_000;
const holds = (s: Stop | undefined) => !!s && (s.kind !== 'network' || Date.now() - s.at < RETRY_OFFLINE_MS);

interface Got {
  at: number;
  items: NewsItem[];
}

/** Today's news, by source and company, and what stopped a source for the day. */
interface Day {
  day: ISODate;
  /** The end of the Alpha Vantage key it was asked with (a new key asks again). */
  keyTag?: string;
  headlines: Record<string, Got>;
  announcements: Record<string, Got>;
  stopped: Partial<Record<Source, Stop>>;
  /** Alpha Vantage requests made today, counted on this phone. */
  used: number;
}

// In this browser, not the database: it's only for today, and it's never backed up.
const STORE = 'financeNews';
const empty = (day: ISODate): Day => ({ day, headlines: {}, announcements: {}, stopped: {}, used: 0 });
let memory: Day | undefined;

function read(day: ISODate): Day {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Day | null;
    if (d?.day === day && d.headlines && d.announcements && d.stopped) return d;
  } catch {
    // Storage blocked: kept for this visit only.
  }
  return memory?.day === day ? memory : empty(day);
}

const listeners = new Set<() => void>();
function write(d: Day) {
  memory = d;
  try {
    localStorage.setItem(STORE, JSON.stringify(d));
  } catch {
    // As above.
  }
  for (const l of listeners) l();
}

const update = (day: ISODate, change: (d: Day) => Day) => write(change(read(day)));
const tag = (key: string) => key.slice(-4);

const sent: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for an Alpha Vantage request's turn under the minute's limit, and counts it (or stops at the day's). */
async function turn(day: ISODate): Promise<void> {
  const { perMinute, perDay } = limits();
  for (;;) {
    if (read(day).used >= perDay) throw new NewsError('limit', 'day');
    const now = Date.now();
    while (sent.length && now - sent[0] >= 60_000) sent.shift();
    if (sent.length < perMinute) break;
    await sleep(60_000 - (now - sent[0]) + 100);
  }
  sent.push(Date.now());
  update(day, (d) => ({ ...d, used: d.used + 1 }));
}

const priceKind = (e: unknown): NewsErrorKind => {
  const kind = e instanceof PriceError ? e.kind : 'other';
  return kind === 'symbol' ? 'other' : kind;
};

/** One run at a time: a summary opened again while one runs waits for it (and skips what it got). */
let chain: Promise<void> = Promise.resolve();

async function run(tickers: string[], day: ISODate, avKey: string | undefined, announcements: boolean): Promise<void> {
  if (avKey) {
    if (read(day).keyTag !== tag(avKey)) update(day, (d) => ({ ...d, keyTag: tag(avKey), headlines: {}, stopped: { ...d.stopped, headlines: undefined } }));
    for (const t of tickers) {
      const d = read(day);
      if (holds(d.stopped.headlines)) break;
      if (d.headlines[t]) continue;
      try {
        await turn(day);
        const body = await fetchHeadlines(t, day, avKey);
        update(day, (x) => ({ ...x, headlines: { ...x.headlines, [t]: { at: Date.now(), items: headlinesFrom(body, t) } } }));
      } catch (e) {
        const kind = e instanceof NewsError ? e.kind : 'other';
        // A company it has nothing on is just that; a key it won't take, the day's limit or no connection stops the rest.
        if (kind === 'other') update(day, (x) => ({ ...x, headlines: { ...x.headlines, [t]: { at: Date.now(), items: [] } } }));
        else {
          update(day, (x) => ({ ...x, stopped: { ...x.stopped, headlines: { kind, at: Date.now() } } }));
          break;
        }
      }
    }
  }
  if (announcements) {
    const from = addDays(day, -NEWS_DAYS);
    for (const t of tickers) {
      const d = read(day);
      if (holds(d.stopped.announcements)) break;
      if (d.announcements[t]) continue;
      try {
        const body = await announcementsSince(t, from);
        update(day, (x) => ({ ...x, announcements: { ...x.announcements, [t]: { at: Date.now(), items: announcementsFrom(body, t) } } }));
      } catch (e) {
        const kind = priceKind(e);
        if (kind === 'other' || kind === 'plan') update(day, (x) => ({ ...x, announcements: { ...x.announcements, [t]: { at: Date.now(), items: [] } } }));
        else {
          update(day, (x) => ({ ...x, stopped: { ...x.stopped, announcements: { kind, at: Date.now() } } }));
          break;
        }
      }
    }
  }
}

export interface StockNews {
  items: NewsItem[];
  /** Still asking about some of them. */
  loading: boolean;
  /** Headlines are on (there's a key). */
  headlinesOn: boolean;
  /** What stopped a source today. */
  stopped: Partial<Record<Source, NewsErrorKind>>;
}

const stoppedNow = (d: Day): Partial<Record<Source, NewsErrorKind>> => ({
  ...(holds(d.stopped.headlines) ? { headlines: d.stopped.headlines!.kind } : {}),
  ...(holds(d.stopped.announcements) ? { announcements: d.stopped.announcements!.kind } : {}),
});

/** News about these companies (each asked about once a day), as it comes in. */
export function useStockNews(tickers: string[], day: ISODate): StockNews {
  const avKey = useMeta<string>(NEWS_KEY)?.trim() || undefined;
  const tdKey = useMeta<string>(TWELVE_DATA_KEY)?.trim() || undefined;
  const announcements = useMeta<boolean>(ANNOUNCEMENTS) !== false && !!tdKey;
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const want = tickers.join(',');
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (!tickers.length || (!avKey && !announcements)) return;
    let live = true;
    setLoading(true);
    const next = chain.then(() => run(tickers, day, avKey, announcements)).catch(() => {});
    chain = next;
    void next.finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [want, day, avKey, announcements]);
  const d = read(day);
  const items: NewsItem[] = [];
  for (const t of tickers) {
    if (avKey && d.keyTag === tag(avKey)) items.push(...(d.headlines[t]?.items ?? []));
    if (announcements) items.push(...(d.announcements[t]?.items ?? []));
  }
  return { items, loading, headlinesOn: !!avKey, stopped: stoppedNow(d) };
}

/** What stopped headlines today, for Settings. */
export function newsStoppedToday(day: ISODate): NewsErrorKind | undefined {
  return stoppedNow(read(day)).headlines;
}
