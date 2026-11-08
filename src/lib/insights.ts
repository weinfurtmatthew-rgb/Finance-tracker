/**
 * "Worth a look" on the Portfolio page: facts about your investments that may be worth a minute, the most
 * pressing first. Each says what is, or what would happen; none says to buy or sell.
 */
import type { Account, Cents, ISODate, Security } from '../types';
import { formatShortDate } from './dates';
import { formatMoney } from './money';
import { formatPrice } from './holdings';
import { concentration, isStock, mixByKind } from './mix';
import { trendOf } from './market';
import { harvestable, openLots, turningLongTerm } from './taxes';
import type { Portfolio } from './portfolio';

export type InsightKind = 'long-term' | 'loss' | 'concentration' | 'cash' | 'below-high';

export interface Insight {
  /** The same while it's the same fact. */
  key: string;
  kind: InsightKind;
  title: string;
  detail: string;
  /** Dated, and soon: it can go on Today, in a line. */
  soon?: boolean;
  brief?: string;
  /** What it's about, to open. */
  accountId?: string;
  ticker?: string;
}

/** Gains turning long-term this soon are worth a look, and this big. */
export const LONG_TERM_DAYS = 30;
const LONG_TERM_MIN = 10_000;
/** On Today when it's this close. */
const SOON_DAYS = 14;
/** A loss this big, and this share of what it cost. */
const LOSS_MIN = 25_000;
const LOSS_SHARE = 0.05;
/** Cash this big, and this share of everything (without a target mix that plans for it). */
const CASH_MIN = 100_000;
const CASH_SHARE = 0.1;
/** A company this far below its high for the last year. */
export const BELOW_HIGH = 0.25;

const whole = (c: Cents) => formatMoney(c, { whole: true });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const named = (a: Account) => a.name;
const longDate = (d: ISODate) => `${formatShortDate(d)}, ${d.slice(0, 4)}`;

export function portfolioInsights(args: {
  p: Portfolio;
  accounts: Account[];
  securities: Map<string, Security>;
  /** A target mix is set (it says how much cash is planned). */
  hasTarget: boolean;
  today: ISODate;
}): Insight[] {
  const { p, accounts, securities, today } = args;
  const out: Insight[] = [];
  const lots = openLots(p, accounts, today);
  const december = today.slice(5, 7) === '12';
  const year = today.slice(0, 4);

  for (const t of turningLongTerm(lots, LONG_TERM_DAYS, LONG_TERM_MIN))
    out.push({
      key: `long-term:${t.account.id}:${t.ticker}:${t.on}`,
      kind: 'long-term',
      title: `${t.ticker} turns long-term ${t.days === 1 ? 'tomorrow' : formatShortDate(t.on)}`,
      detail: `The shares bought ${longDate(t.acquired)} in ${named(t.account)}: sold from ${formatShortDate(t.on)} on, their ${whole(t.gain)} gain is taxed at the lower long-term rate.`,
      soon: t.days <= SOON_DAYS,
      brief: `In ${named(t.account)}: sold from then on, its ${whole(t.gain)} gain is taxed at the lower rate`,
      accountId: t.account.id,
      ticker: t.ticker,
    });

  for (const h of harvestable(p, accounts, lots, today, LOSS_MIN)) {
    if (h.loss < h.cost * LOSS_SHARE) continue;
    const short = h.shortLoss > 0 ? `, ${h.shortLoss === h.loss ? 'all' : whole(h.shortLoss)} short-term` : '';
    const wash = h.washBuy
      ? ` ${h.washBuy.reinvested ? 'A dividend bought more' : 'Bought'} in ${named(h.washBuy.account)} ${formatShortDate(h.washBuy.date)}: sold at a loss before ${formatShortDate(h.washBuy.clearOn)}, it’s a wash sale and the loss can’t be claimed.`
      : '';
    out.push({
      key: `loss:${h.account.id}:${h.ticker}`,
      kind: 'loss',
      title: `${h.ticker} is ${whole(h.loss)} below what you paid`,
      detail: `In ${named(h.account)}${short}. A realized loss offsets gains, then up to $3,000 a year of other income.${
        december ? ` Sold by Dec 31, it counts for ${year}.` : ''
      }${wash}`,
      soon: december,
      brief: `In ${named(h.account)}: a loss realized by Dec 31 counts for ${year}`,
      accountId: h.account.id,
      ticker: h.ticker,
    });
  }

  for (const c of concentration(p, securities)) {
    const share = pct(c.share);
    out.push(
      c.kind === 'stock'
        ? {
            key: `concentration:${c.tickers[0]}`,
            kind: 'concentration',
            title: `${c.tickers[0]} is ${share} of your investments`,
            detail: 'A bad year for one company would hit hard. Funds don’t count here: they hold many companies.',
            ticker: c.tickers[0],
          }
        : c.kind === 'top3'
          ? {
              key: 'concentration:top3',
              kind: 'concentration',
              title: `Your 3 biggest companies are ${share} of your investments`,
              detail: `${c.tickers.join(', ')}. Funds don’t count here: they hold many companies.`,
            }
          : {
              key: `concentration:${c.sector}`,
              kind: 'concentration',
              title: `${c.sector} companies are ${share} of your investments`,
              detail: `${c.tickers.join(', ')}: a slump in one industry would hit them all.`,
            },
    );
  }

  if (!args.hasTarget) {
    const mix = mixByKind(p, securities);
    const cash = mix.slices.find((s) => s.key === 'cash');
    if (cash && cash.value >= CASH_MIN && cash.share >= CASH_SHARE)
      out.push({
        key: 'cash',
        kind: 'cash',
        title: `${pct(cash.share)} of your investments is cash`,
        detail: `${whole(cash.value)} of ${whole(mix.total)}, as cash or money market funds. If that’s on purpose, a target mix with cash in it says so.`,
      });
  }

  // Companies far below their high (a fund that far down is the market's story, on this page too).
  const seen = new Set<string>();
  for (const hs of p.accounts)
    for (const pos of hs.positions) {
      if (seen.has(pos.ticker) || !((pos.shares ?? 0) > 0) || pos.source !== 'market' || !isStock(securities.get(pos.ticker), pos.ticker)) continue;
      seen.add(pos.ticker);
      const t = trendOf(pos.history);
      if (!t || t.fromHigh < BELOW_HIGH) continue;
      out.push({
        key: `below-high:${pos.ticker}`,
        kind: 'below-high',
        title: `${pos.ticker} is ${pct(t.fromHigh)} below its high`,
        detail: `${formatPrice(t.high)} on ${formatShortDate(t.highDate)}, ${formatPrice(t.price)} at the close ${formatShortDate(t.date)}${
          t.fullYear ? '' : ` (its prices here start ${formatShortDate(t.since)})`
        }. Where it’s been, not where it’s going.`,
        accountId: hs.accountId,
        ticker: pos.ticker,
      });
    }
  return out;
}
