import type { Page } from '@playwright/test';

/**
 * A stand-in for Twelve Data, the price service: made-up daily closes for a few tickers, served the way
 * the real one does (three ways of adjusting them, its errors, ticker search and usage).
 */
export interface MockTicker {
  ticker: string;
  name: string;
  type: string;
  exchange: string;
  /** The close on the i-th weekday (from Jun 2, 2025), in today's shares. */
  price: (i: number) => number;
  /** Shares after per share before, on the day it took effect. */
  splits?: [string, number][];
  /** Per share in today's shares, on its ex-dividend date. */
  dividends?: [string, number][];
  /** Its press releases, as the price service sends them (the body is HTML). */
  pressReleases?: { id: number; datetime: string; title: string; body: string }[];
}

export const MOCK_KEY = 'test-key';

/** The S&P 500 fund the app compares with: steadily up, no dividends (to keep the sums simple). */
export const SPY: MockTicker = { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'ETF', exchange: 'NYSE', price: (i) => 400 + 0.2 * i };

/** Weekdays from Jun 2, 2025 through Sep 28, 2026 (the day before the tests' frozen "today"). */
export const DAYS: string[] = (() => {
  const out: string[] = [];
  for (let t = Date.parse('2025-06-02T12:00:00Z'); t <= Date.parse('2026-09-28T12:00:00Z'); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
})();

/** The close on a day (or the last weekday before it), in today's shares. */
export function closeOn(m: MockTicker, date: string): number {
  let i = DAYS.length - 1;
  while (i > 0 && DAYS[i] > date) i--;
  return m.price(i);
}

/** Each day's close as traded, adjusted for later splits, and for later splits and dividends. */
function series(m: MockTicker) {
  return DAYS.map((date, i) => {
    const split = m.price(i);
    const raw = split * (m.splits ?? []).reduce((f, [d, x]) => (d > date ? f * x : f), 1);
    let all = split;
    for (const [d, amount] of m.dividends ?? []) {
      if (d <= date) continue;
      const prev = m.price(DAYS.indexOf(d) - 1);
      all *= prev / (prev + amount);
    }
    return { date, raw, split, all };
  });
}

export const MOCK_NEWS_KEY = 'news-test-key';

/** An article as Alpha Vantage sends it, about one company. */
export interface MockArticle {
  title: string;
  url: string;
  /** "20260925T143000" */
  time: string;
  source: string;
  summary: string;
  ticker: string;
  relevance: number;
}

/** Routes Alpha Vantage's news to a stand-in; returns the requests it got (its query). */
export async function mockAlphaVantage(page: Page, articles: MockArticle[], opts: { limitReached?: boolean } = {}): Promise<string[]> {
  const log: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __financeNewsLimits: unknown }).__financeNewsLimits = { perMinute: 1000 };
  });
  await page.route('https://www.alphavantage.co/**', async (route) => {
    const url = new URL(route.request().url());
    log.push(`${url.searchParams}`);
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const q = (k: string) => url.searchParams.get(k) ?? '';
    if (q('apikey') !== MOCK_NEWS_KEY) return reply({ 'Error Message': 'the parameter apikey is invalid or missing. Please claim your dedicated API key.' });
    if (opts.limitReached)
      return reply({
        Information: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day. Please subscribe to any of the premium plans.',
      });
    if (q('function') !== 'NEWS_SENTIMENT') return reply({ Information: 'Invalid API call.' });
    const feed = articles
      .filter((a) => a.ticker === q('tickers') && a.time >= q('time_from'))
      .map((a) => ({
        title: a.title,
        url: a.url,
        time_published: a.time,
        authors: [],
        summary: a.summary,
        banner_image: 'https://images.example.com/banner.jpg',
        source: a.source,
        ticker_sentiment: [{ ticker: a.ticker, relevance_score: String(a.relevance), ticker_sentiment_score: '0.1', ticker_sentiment_label: 'Neutral' }],
      }));
    return reply({ items: String(feed.length), feed });
  });
  return log;
}

/** Routes the price service to the stand-in; returns the requests it got (path and query). */
export async function mockTwelveData(page: Page, tickers: MockTicker[]): Promise<string[]> {
  const log: string[] = [];
  // The tests' clock is frozen, so the per-minute limit would never reset.
  await page.addInitScript(() => {
    (window as unknown as { __financePriceLimits: unknown }).__financePriceLimits = { perMinute: 1000 };
  });
  await page.route('https://api.twelvedata.com/**', async (route) => {
    const url = new URL(route.request().url());
    log.push(`${url.pathname}?${url.searchParams}`);
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    const error = (code: number, message: string) => reply({ code, message, status: 'error' });
    const q = (k: string) => url.searchParams.get(k) ?? '';
    if (url.pathname === '/symbol_search') {
      const text = q('symbol').toLowerCase();
      const data = tickers
        .filter((t) => t.ticker.toLowerCase().startsWith(text) || t.name.toLowerCase().includes(text))
        .map((t) => ({
          symbol: t.ticker,
          instrument_name: t.name,
          exchange: t.exchange,
          instrument_type: t.type,
          country: 'United States',
          access: { plan: 'Basic' },
        }));
      return reply({ data, status: 'ok' });
    }
    if (q('apikey') !== MOCK_KEY)
      return error(
        401,
        '**apikey** parameter is incorrect or not specified. You can get your free API key instantly following this link: https://twelvedata.com/pricing.',
      );
    if (url.pathname === '/api_usage')
      return reply({ timestamp: '2026-09-29 16:00:00', current_usage: 1, plan_limit: 8, daily_usage: 5, plan_daily_limit: 800, plan_category: 'basic' });
    if (url.pathname === '/press_releases') {
      const m = tickers.find((t) => t.ticker === q('symbol'));
      const from = q('start_date').slice(0, 10);
      return reply({ press_releases: (m?.pressReleases ?? []).filter((p) => p.datetime.slice(0, 10) >= from), status: 'ok' });
    }
    if (url.pathname === '/time_series') {
      const m = tickers.find((t) => t.ticker === q('symbol'));
      if (!m) return error(404, `**symbol** not found: ${q('symbol')}. Please specify it correctly according to API Documentation.`);
      const pick = q('adjust') === 'none' ? 'raw' : q('adjust') === 'all' ? 'all' : 'split';
      const values = series(m)
        .filter((b) => b.date >= q('start_date'))
        .map((b) => ({ datetime: b.date, close: b[pick].toFixed(5) }));
      return reply({
        meta: {
          symbol: m.ticker,
          interval: '1day',
          currency: 'USD',
          exchange_timezone: 'America/New_York',
          exchange: m.exchange,
          mic_code: 'ARCX',
          type: m.type,
        },
        values,
        status: 'ok',
      });
    }
    return error(404, 'Not found');
  });
  return log;
}
