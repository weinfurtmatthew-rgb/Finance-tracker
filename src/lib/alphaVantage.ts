/**
 * Alpha Vantage (alphavantage.co): news headlines about a company, with a free key of your own. It's
 * called straight from this phone; only a ticker symbol and the key are sent. See lib/news.ts for what's
 * read from the reply.
 */
import type { ISODate } from '../types';
import { avFrom, avProblem, NewsError } from './news';

const BASE = 'https://www.alphavantage.co/query';
export const AV_SIGN_UP_URL = 'https://www.alphavantage.co/support/#api-key';

/** News that mentions a company, from the last week, newest first (1 request). */
export async function fetchHeadlines(ticker: string, today: ISODate, key: string): Promise<unknown> {
  const q = new URLSearchParams({ function: 'NEWS_SENTIMENT', tickers: ticker, time_from: avFrom(today), sort: 'LATEST', limit: '50', apikey: key });
  let res: Response;
  try {
    res = await fetch(`${BASE}?${q}`);
  } catch {
    throw new NewsError('network', 'offline');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new NewsError(res.ok ? 'other' : 'network', `Unexpected reply (${res.status})`);
  }
  const problem = avProblem(body);
  if (problem) throw problem;
  return body;
}
