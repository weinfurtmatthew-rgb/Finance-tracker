/**
 * News about the stocks you hold, for the morning summary: headlines from Alpha Vantage (alphavantage.co,
 * with a free key of your own) and company announcements from Twelve Data (the price service, with the
 * same key as prices). Both are called straight from this phone, and only ticker symbols are sent.
 *
 * What comes back is shown as plain text: an announcement's HTML is never put on the page, and no
 * pictures are loaded. These are pure functions, so they're easy to test.
 */
import type { ISODate, Security } from '../types';
import { addDays } from './dates';

/** The Alpha Vantage key (kept on this phone, never in backups). */
export const NEWS_KEY = 'alphaVantageKey';
/** Company announcements from Twelve Data, on unless turned off (they use the price key). */
export const ANNOUNCEMENTS = 'companyAnnouncements';

/** News for this many of your biggest stock holdings (the free news plan allows 25 requests a day). */
export const NEWS_TICKERS = 6;
/** How far back news goes. */
export const NEWS_DAYS = 7;
/** An article has to be at least this much about a company to count as news about it (0 to 1). */
export const MIN_RELEVANCE = 0.3;

export interface NewsItem {
  id: string;
  ticker: string;
  kind: 'headline' | 'announcement';
  title: string;
  /** When it came out (ms). */
  time: number;
  /** Who published it ("Reuters"); an announcement is the company's own. */
  source?: string;
  /** The article, for a headline (https only). */
  url?: string;
  /** A few lines of it, as plain text. */
  text?: string;
}

export type NewsErrorKind = 'key' | 'limit' | 'plan' | 'network' | 'other';

export class NewsError extends Error {
  constructor(
    readonly kind: NewsErrorKind,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '’',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/** Text from HTML: tags dropped (and what's in scripts and styles), breaks kept as spaces, entities read. */
export function plainText(html: unknown): string {
  return String(html ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** At most `max` characters, cut at a word, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------------------
// Which stocks
// ---------------------------------------------------------------------------------------------

/** Funds and the like have no company news of their own. */
const FUND = /etf|fund|trust|etn|index|bond|money market/i;

/** The stocks to get news for: individual companies you hold, biggest first. */
export function newsTickers(holdings: { ticker: string; value: number }[], securities: Map<string, Security>, max = NEWS_TICKERS): string[] {
  return holdings
    .filter((h) => h.value > 0 && !FUND.test(securities.get(h.ticker)?.type ?? '') && /^[A-Z][A-Z0-9.-]{0,9}$/.test(h.ticker))
    .sort((a, b) => b.value - a.value)
    .slice(0, max)
    .map((h) => h.ticker);
}

// ---------------------------------------------------------------------------------------------
// Alpha Vantage headlines
// ---------------------------------------------------------------------------------------------

/** Alpha Vantage's "20261116T141449" (the minutes and seconds may be missing) → ms, as UTC. */
export function avTime(s: unknown): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})?(\d{2})?$/.exec(String(s ?? ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +(m[5] ?? 0), +(m[6] ?? 0));
}

/** "20261109T0000": where a search for the last `days` days starts. */
export const avFrom = (today: ISODate, days = NEWS_DAYS) => `${addDays(today, -days).replace(/-/g, '')}T0000`;

/** What a reply that isn't news says went wrong (Alpha Vantage answers 200 with a note instead). */
export function avProblem(body: unknown): NewsError | null {
  if (!body || typeof body !== 'object') return new NewsError('other', 'Unexpected reply');
  const b = body as Record<string, unknown>;
  const said = String(b['Error Message'] ?? b.Information ?? b.Note ?? '');
  if (Array.isArray(b.feed)) return null;
  if (!said) return new NewsError('other', 'Unexpected reply');
  if (/api ?key/i.test(said) && /invalid|missing|not valid/i.test(said)) return new NewsError('key', said);
  if (/rate limit|requests per day|per minute|frequency|premium|spreading out/i.test(said)) return new NewsError('limit', said);
  if (b['Error Message']) return new NewsError('other', said);
  return new NewsError('other', said);
}

const https = (u: unknown) => {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** The articles in a reply that are about `ticker`, newest first (no repeats). */
export function headlinesFrom(body: unknown, ticker: string): NewsItem[] {
  const feed = (body as { feed?: unknown[] })?.feed;
  if (!Array.isArray(feed)) return [];
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const raw of feed) {
    const a = raw as Record<string, unknown>;
    const about = Array.isArray(a.ticker_sentiment)
      ? (a.ticker_sentiment as Record<string, unknown>[]).find((t) => String(t.ticker).toUpperCase() === ticker)
      : undefined;
    if (!about || !(Number(about.relevance_score) >= MIN_RELEVANCE)) continue;
    const title = clip(plainText(a.title), 200);
    const url = https(a.url);
    const time = avTime(a.time_published);
    if (!title || !url || !Number.isFinite(time)) continue;
    const key = title.toLowerCase();
    if (seen.has(url) || seen.has(key)) continue;
    seen.add(url);
    seen.add(key);
    const source = clip(plainText(a.source), 60);
    const text = clip(plainText(a.summary), 280);
    out.push({ id: url, ticker, kind: 'headline', title, time, url, ...(source ? { source } : {}), ...(text ? { text } : {}) });
  }
  return out.sort((x, y) => y.time - x.time);
}

// ---------------------------------------------------------------------------------------------
// Twelve Data announcements
// ---------------------------------------------------------------------------------------------

/** "2026-11-12T13:05:00" (or with a space) → ms, as UTC. */
function tdTime(s: unknown): number {
  const t = Date.parse(
    `${String(s ?? '')
      .trim()
      .replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(s ?? '')) ? '' : 'Z'}`,
  );
  return Number.isFinite(t) ? t : NaN;
}

/** A company's announcements in a reply, newest first. */
export function announcementsFrom(body: unknown, ticker: string): NewsItem[] {
  const list = (body as { press_releases?: unknown[] })?.press_releases;
  if (!Array.isArray(list)) return [];
  const out: NewsItem[] = [];
  for (const raw of list) {
    const p = raw as Record<string, unknown>;
    const title = clip(plainText(p.title), 200);
    const time = tdTime(p.datetime);
    if (!title || !Number.isFinite(time)) continue;
    const text = clip(plainText(p.body), 900);
    out.push({ id: `${ticker}:${String(p.id ?? p.datetime)}`, ticker, kind: 'announcement', title, time, ...(text ? { text } : {}) });
  }
  return out.sort((x, y) => y.time - x.time);
}

// ---------------------------------------------------------------------------------------------
// What the summary shows
// ---------------------------------------------------------------------------------------------

/** Headlines (up to 2 a company, 6 in all) and announcements (1 a company, 3 in all), newest first. */
export function pickNews(items: NewsItem[], now: number, days = NEWS_DAYS): { headlines: NewsItem[]; announcements: NewsItem[] } {
  const since = now - days * 86_400_000;
  const take = (kind: NewsItem['kind'], each: number, all: number) => {
    const per = new Map<string, number>();
    return items
      .filter((i) => i.kind === kind && i.time >= since && i.time <= now + 3600_000)
      .sort((a, b) => b.time - a.time)
      .filter((i) => {
        const n = per.get(i.ticker) ?? 0;
        if (n >= each) return false;
        per.set(i.ticker, n + 1);
        return true;
      })
      .slice(0, all);
  };
  return { headlines: take('headline', 2, 6), announcements: take('announcement', 1, 3) };
}

/** "Today", "Yesterday", "Friday" or "Nov 3", in local time. */
export function newsDay(time: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(time)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(time).toLocaleDateString('en-US', { weekday: 'long' });
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
