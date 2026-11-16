import { describe, expect, it } from 'vitest';
import { announcementsFrom, avFrom, avProblem, avTime, clip, headlinesFrom, newsDay, newsTickers, pickNews, plainText, type NewsItem } from '../src/lib/news';
import type { Security } from '../src/types';

const article = (over: Record<string, unknown> = {}) => ({
  title: 'Northwind Robotics wins a warehouse contract',
  url: 'https://news.example.com/northwind-contract',
  time_published: '20260925T143000',
  summary: 'Northwind Robotics said on Friday it will supply robots to a warehouse chain.',
  banner_image: 'https://news.example.com/picture.jpg',
  source: 'Example Wire',
  ticker_sentiment: [{ ticker: 'NWRX', relevance_score: '0.82', ticker_sentiment_score: '0.31', ticker_sentiment_label: 'Somewhat-Bullish' }],
  ...over,
});

describe('plain text', () => {
  it('drops tags, scripts and styles, and reads entities', () => {
    expect(plainText('<p>Record <b>quarter</b> &amp; more&nbsp;to&#160;come</p><script>alert(1)</script><style>p{}</style>')).toBe(
      'Record quarter & more to come',
    );
    expect(plainText('<img src=x onerror=alert(1)>Hi &lt;there&gt; &#x2014; &unknown;')).toBe('Hi <there> — &unknown;');
    expect(plainText(undefined)).toBe('');
  });
  it('clips at a word', () => {
    expect(clip('one two three four', 11)).toBe('one two…');
    expect(clip('short', 11)).toBe('short');
  });
});

describe('which stocks', () => {
  it('companies only, biggest first, at most a few', () => {
    const securities = new Map<string, Security>([
      ['VTI', { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'ETF' }],
      ['FXAIX', { ticker: 'FXAIX', name: 'Fidelity 500 Index Fund', type: 'Mutual Fund' }],
      ['AAA', { ticker: 'AAA', name: 'A Co', type: 'Common Stock' }],
      ['BBB', { ticker: 'BBB', name: 'B Co', type: 'Common Stock' }],
    ]);
    const holdings = [
      { ticker: 'VTI', value: 900 },
      { ticker: 'AAA', value: 100 },
      { ticker: 'FXAIX', value: 800 },
      { ticker: 'BBB', value: 300 },
      { ticker: 'CCC', value: 50 },
      { ticker: 'GONE', value: 0 },
    ];
    expect(newsTickers(holdings, securities)).toEqual(['BBB', 'AAA', 'CCC']);
    expect(newsTickers(holdings, securities, 2)).toEqual(['BBB', 'AAA']);
  });
});

describe('Alpha Vantage', () => {
  it('reads its times, and where a week back starts', () => {
    expect(avTime('20260925T143000')).toBe(Date.UTC(2026, 8, 25, 14, 30, 0));
    expect(avTime('20260925T1430')).toBe(Date.UTC(2026, 8, 25, 14, 30, 0));
    expect(avTime('nope')).toBeNaN();
    expect(avFrom('2026-09-29')).toBe('20260922T0000');
  });
  it('articles about the company, newest first, as plain text with only https links', () => {
    const body = {
      feed: [
        article(),
        article({ title: 'A newer story', url: 'https://news.example.com/newer', time_published: '20260927T090000' }),
        // Only mentions it in passing.
        article({ title: 'Markets roundup', url: 'https://news.example.com/roundup', ticker_sentiment: [{ ticker: 'NWRX', relevance_score: '0.05' }] }),
        // About something else.
        article({ title: 'Another company', url: 'https://news.example.com/other', ticker_sentiment: [{ ticker: 'ZZZ', relevance_score: '0.9' }] }),
        // The same story twice.
        article({ url: 'https://news.example.com/northwind-contract' }),
        // Not https.
        article({ title: 'Insecure', url: 'http://news.example.com/insecure' }),
        article({ title: '<b>Bold</b> &amp; plain', url: 'https://news.example.com/html', summary: '<script>x()</script>Fine.' }),
      ],
    };
    const items = headlinesFrom(body, 'NWRX');
    expect(items.map((i) => i.title)).toEqual(['A newer story', 'Northwind Robotics wins a warehouse contract', 'Bold & plain']);
    expect(items[1]).toMatchObject({ kind: 'headline', ticker: 'NWRX', source: 'Example Wire', url: 'https://news.example.com/northwind-contract' });
    expect(items[2].text).toBe('Fine.');
    expect(JSON.stringify(items)).not.toContain('picture.jpg');
  });
  it('tells a refused key from the day’s limit', () => {
    expect(avProblem({ feed: [] })).toBeNull();
    expect(avProblem({ 'Error Message': 'the parameter apikey is invalid or missing.' })?.kind).toBe('key');
    expect(avProblem({ Information: 'Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day.' })?.kind).toBe('limit');
    expect(avProblem({ Note: 'Please consider spreading out your free API requests more sparingly (1 request per second).' })?.kind).toBe('limit');
    expect(avProblem({ Information: 'The **demo** API key is for demo purposes only.' })?.kind).toBe('other');
    expect(avProblem('nope')?.kind).toBe('other');
  });
});

describe('Twelve Data announcements', () => {
  it('as plain text, newest first', () => {
    const body = {
      press_releases: [
        { id: 7, datetime: '2026-09-21T12:00:00', title: 'Northwind to present at a conference', body: '<p>It will present.</p>' },
        { id: 9, datetime: '2026-09-24 13:05:00', title: 'Northwind reports a <b>record</b> quarter', body: '<p>Revenue rose.</p><script>bad()</script>' },
        { id: 10, datetime: 'whenever', title: 'Undated' },
      ],
    };
    const items = announcementsFrom(body, 'NWRX');
    expect(items.map((i) => i.title)).toEqual(['Northwind reports a record quarter', 'Northwind to present at a conference']);
    expect(items[0]).toMatchObject({ id: 'NWRX:9', kind: 'announcement', text: 'Revenue rose.', time: Date.UTC(2026, 8, 24, 13, 5) });
    expect(announcementsFrom({ status: 'error' }, 'NWRX')).toEqual([]);
  });
});

describe('what the summary shows', () => {
  const now = Date.UTC(2026, 8, 29, 12);
  const item = (ticker: string, kind: NewsItem['kind'], daysAgo: number, n = 0): NewsItem => ({
    id: `${ticker}${kind}${daysAgo}${n}`,
    ticker,
    kind,
    title: `${ticker} ${daysAgo}`,
    time: now - daysAgo * 86_400_000 - n,
  });
  it('a couple of headlines a company and one announcement, from the last week', () => {
    const items = [item('AAA', 'headline', 1), item('AAA', 'headline', 2), item('AAA', 'headline', 3), item('BBB', 'headline', 0), item('BBB', 'headline', 9)];
    items.push(item('AAA', 'announcement', 2), item('AAA', 'announcement', 1), item('BBB', 'announcement', 4));
    const { headlines, announcements } = pickNews(items, now);
    expect(headlines.map((i) => i.title)).toEqual(['BBB 0', 'AAA 1', 'AAA 2']);
    expect(announcements.map((i) => i.title)).toEqual(['AAA 1', 'BBB 4']);
  });
  it('says when, in days', () => {
    const local = new Date(2026, 8, 29, 9).getTime();
    expect(newsDay(local - 3600_000, local)).toBe('Today');
    expect(newsDay(new Date(2026, 8, 28, 20).getTime(), local)).toBe('Yesterday');
    expect(newsDay(new Date(2026, 8, 25, 20).getTime(), local)).toBe('Friday');
    expect(newsDay(new Date(2026, 8, 12, 20).getTime(), local)).toBe('Sep 12');
  });
});
