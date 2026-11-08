/**
 * Browse → Portfolio: everything in your investment accounts together. What it's worth, how it did over a
 * period next to the S&P 500, what's worth a look, each holding, taxes, and your return since you started
 * (lib/portfolio.ts).
 */
import { useMemo, useState } from 'preact/hooks';
import { useAccounts, useMeta } from '../hooks';
import type { Account } from '../types';
import { useNav } from '../nav';
import { usePortfolio, usePrices, useSecurities } from '../portfolioModel';
import {
  BENCHMARK,
  PERIODS,
  benchmarkResult,
  holdingsByTicker,
  periodResult,
  periodStart,
  yearlyReturn,
  type Holding,
  type Period,
  type Portfolio,
} from '../lib/portfolio';
import { formatShares, holdingsValueOn } from '../lib/holdings';
import { TWELVE_DATA_KEY } from '../lib/twelveData';
import { formatDate, formatShortDate, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Empty, Row, Section, Segmented, Sheet } from '../components/ui';
import { LineChart } from '../components/charts';
import { CountUp } from '../components/motion';
import { AccountDetail } from './AccountDetail';
import { HoldingSheet } from './Holdings';
import { StockPricesSheet } from './StockPrices';
import { DividendsSection, MixSection } from './PortfolioMix';
import { MarketSection, TaxesSection, WorthALookSection } from './PortfolioInsights';

const whole = (c: number) => formatMoney(c, { whole: true });
const signedWhole = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${whole(Math.abs(c))}`;
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;
const tone = (x: number | null | undefined) => (x == null || Math.abs(x) < 1e-9 ? '' : x > 0 ? 'pos-text' : 'neg-text');

/** A chart axis that fits the values (a change of a few percent would be flat on one from zero). */
function fitDomain(values: number[]): [number, number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 100);
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const from = Math.max(0, Math.floor(lo / step) * step);
  return [from, Math.max(from + step, Math.ceil(hi / step) * step), step];
}

/** At most `max` points for a chart (the first and last always kept). */
function thin<T>(items: T[], max = 120): number[] {
  if (items.length <= max) return items.map((_, i) => i);
  const every = Math.ceil(items.length / max);
  const out = items.map((_, i) => i).filter((i) => i % every === 0);
  if (out[out.length - 1] !== items.length - 1) out.push(items.length - 1);
  return out;
}

export function PortfolioSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const accounts = useAccounts();
  const hasKey = !!useMeta<string>(TWELVE_DATA_KEY);
  const today = todayISO();
  const p = usePortfolio();
  return (
    <Sheet title="Portfolio" onClose={props.onClose}>
      {!p ? (
        <Empty icon="pie" title="Track your stocks and funds">
          <p>
            Add what’s in your brokerage account, IRA or 401(k) on its page in Net Worth: how much you put in and when. Then this shows how it’s doing, next to
            the S&amp;P 500.
          </p>
          <button
            type="button"
            class="button primary"
            onClick={() => {
              props.onClose();
              nav.setTab('accounts');
            }}
          >
            Go to Net Worth
          </button>
          {!hasKey && (
            <button type="button" class="button" onClick={() => nav.present((close) => <StockPricesSheet onClose={close} />)}>
              Turn On Stock Prices
            </button>
          )}
        </Empty>
      ) : (
        <PortfolioView p={p} accounts={accounts} hasKey={hasKey} today={today} />
      )}
    </Sheet>
  );
}

function PortfolioView(props: { p: Portfolio; accounts: Account[]; hasKey: boolean; today: string }) {
  const { p, today } = props;
  const nav = useNav();
  const prices = usePrices();
  const securities = useSecurities();
  const [period, setPeriod] = useState<Period>('1m');
  const from = periodStart(p, period, today);
  const r = useMemo(() => periodResult(p, from), [p, from]);
  const bench = useMemo(() => benchmarkResult(r, p, prices.get(BENCHMARK)), [r, p, prices]);
  const list = useMemo(() => holdingsByTicker(p, from), [p, from]);
  const all = useMemo(() => periodResult(p, periodStart(p, 'all', today)), [p, today]);
  const yearly = useMemo(() => yearlyReturn(p, today), [p, today]);
  const label = PERIODS.find((x) => x.value === period)!;
  const ranked = list.filter((h) => h.pct != null).sort((a, b) => b.pct! - a.pct!);
  const points = thin(r.dates);
  const chartValues = points.map((i) => r.values[i]);
  const benchValues = bench ? points.map((i) => bench.values[i]) : [];
  const open = (h: Holding) => {
    const pos = [...h.positions].sort((a, b) => b.value - a.value)[0];
    const account = props.accounts.find((a) => a.id === pos.accountId);
    if (account) nav.present((close) => <HoldingSheet account={account} ticker={h.ticker} onClose={close} />);
  };
  const name = (ticker: string) => securities.get(ticker)?.name;

  return (
    <>
      <section class="card lit detail-hero-card portfolio-hero" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 14%, transparent)' }}>
        <span class="card-label">Your investments</span>
        <CountUp class="detail-big num" value={r.endValue} format={(c) => formatMoney(c)} />
        <span class={`change-line ${tone(r.gain)}`}>
          {r.gain >= 0 ? '▲' : '▼'} {whole(Math.abs(r.gain))}
          {r.pct != null && ` (${pct(r.pct)})`} {label.long}
        </span>
        <Segmented value={period} options={PERIODS.map((x) => ({ value: x.value, label: x.label }))} onChange={setPeriod} />
        {period !== '1d' && r.dates.length > 1 && (
          <LineChart
            title={`Your investments ${label.long}${bench ? ', and the same money in the S&P 500' : ''}`}
            dates={points.map((i) => r.dates[i])}
            labels={points.map((i) => formatShortDate(r.dates[i]))}
            series={[
              { name: 'Yours', color: 'var(--chart-1)', values: chartValues },
              ...(bench ? [{ name: 'S&P 500', color: 'var(--chart-2)', values: benchValues }] : []),
            ]}
            domain={fitDomain([...chartValues, ...benchValues])}
          />
        )}
      </section>

      <WorthALookSection p={p} />

      <Section
        title="Vs the S&P 500"
        footer={
          bench
            ? 'The S&P 500 is SPY with its dividends reinvested, with the same money going in and out on the same days as yours. Percents leave out money you added or took out.'
            : props.hasKey
              ? 'The S&P 500’s prices are on their way.'
              : 'With a free price key (Settings → Stock Prices), see how the S&P 500 did with the same money.'
        }
      >
        <Row title="Yours" detail={<span class={tone(r.pct)}>{r.pct != null ? pct(r.pct) : '—'}</span>} chevron={false} />
        {bench && (
          <>
            <Row title="S&P 500" detail={<span class={tone(bench.pct)}>{pct(bench.pct)}</span>} chevron={false} />
            <Row
              title="Same money in the S&P 500"
              subtitle={
                r.endValue === bench.endValue
                  ? 'The same as yours'
                  : `${whole(Math.abs(r.endValue - bench.endValue))} ${r.endValue > bench.endValue ? 'less than yours' : 'more than yours'}`
              }
              detail={whole(bench.endValue)}
              chevron={false}
            />
          </>
        )}
        {!bench && !props.hasKey && <Row title="Turn On Stock Prices" onClick={() => nav.present((close) => <StockPricesSheet onClose={close} />)} />}
      </Section>
      <MarketSection />

      <Section title="Holdings" footer={`Each one’s own change ${label.long}, dividends included (from when you bought it, if that’s later).`}>
        {list.map((h) => (
          <button type="button" class="row holding-row" onClick={() => open(h)}>
            <span class="row-main">
              <span class="row-title holding-title">
                <b>{h.ticker}</b>
                {name(h.ticker) && name(h.ticker) !== h.ticker && <span class="holding-name">{name(h.ticker)}</span>}
              </span>
              <span class="row-subtitle">
                {[
                  r.endValue > 0 && `${Math.round((h.value / r.endValue) * 100)}% of it`,
                  h.positions.length > 1 ? `${h.positions.length} accounts` : h.shares != null && `${formatShares(h.shares)} shares`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span class="row-detail holding-detail">
              <span class="money">{whole(h.value)}</span>
              {h.pct != null && <span class={`small ${tone(h.pct) || 'muted'}`}>{pct(h.pct)}</span>}
            </span>
            <span class="chevron" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </Section>

      {ranked.length >= 3 && (
        <Section title={`Best & worst ${label.long}`}>
          {[ranked[0], ranked[ranked.length - 1]].map((h, i) => (
            <Row
              title={`${i === 0 ? (h.pct! >= 0 ? 'Up most' : 'Down least') : h.pct! >= 0 ? 'Up least' : 'Down most'}: ${h.ticker}`}
              subtitle={name(h.ticker)}
              detail={<span class={tone(h.pct)}>{pct(h.pct!)}</span>}
              onClick={() => open(h)}
            />
          ))}
        </Section>
      )}

      <MixSection p={p} />
      <DividendsSection p={p} value={all.endValue} />
      <TaxesSection p={p} />

      <Section
        title="Since you started"
        footer={
          yearly != null
            ? 'The yearly return counts when your money went in and out, like a savings rate would.'
            : `You started ${formatDate(p.first)}. After a year, this shows your yearly return.`
        }
      >
        <Row
          title={p.flows.some((f) => f < 0) ? 'Put in, less taken out' : 'Put in'}
          subtitle={`since ${formatDate(p.first)}`}
          detail={whole(all.added)}
          chevron={false}
        />
        <Row title="Gain" detail={<span class={tone(all.gain)}>{signedWhole(all.gain)}</span>} chevron={false} />
        {yearly != null && <Row title="Yearly return" detail={<span class={tone(yearly)}>{pct(yearly)} a year</span>} chevron={false} />}
      </Section>

      <Section title="Accounts">
        {p.accounts.map((hs) => {
          const a = props.accounts.find((x) => x.id === hs.accountId);
          if (!a) return null;
          return (
            <Row
              title={a.name}
              subtitle={a.institution || undefined}
              detail={whole(holdingsValueOn(hs))}
              onClick={() => nav.present((close) => <AccountDetail account={a} onClose={close} />)}
            />
          );
        })}
      </Section>
      <p class="section-footer">
        {p.priceDate ? `Prices from Twelve Data, as of the close ${formatShortDate(p.priceDate)}.` : 'Valued at the prices you entered.'} Values include the
        cash in these accounts.
        {list.some((h) => h.positions.some((x) => x.source !== 'market')) &&
          ' Holdings without market prices count at the prices you entered or what you put in.'}
      </p>
    </>
  );
}
