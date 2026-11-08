/**
 * The Portfolio page's "Worth a look" (lib/insights.ts), where the market stands (lib/market.ts), and
 * taxes on selling in brokerage accounts (lib/taxes.ts).
 */
import { useMemo } from 'preact/hooks';
import { useAccounts } from '../hooks';
import { useNav } from '../nav';
import type { Account, Cents } from '../types';
import { useInsights, usePrices } from '../portfolioModel';
import { BENCHMARK, type Portfolio } from '../lib/portfolio';
import type { InsightKind } from '../lib/insights';
import { MOOD_LABEL, fromHighText, moodOf, trendOf } from '../lib/market';
import {
  harvestable,
  isTaxable,
  netGain,
  openLots,
  realizedBetween,
  taxableDividends,
  termText,
  turningLongTerm,
  unrealized,
  type ByTerm,
  type Realized,
} from '../lib/taxes';
import { formatShares } from '../lib/holdings';
import { formatDate, formatShortDate, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Row, Section, Sheet } from '../components/ui';
import { IconChip, type GlyphName, type Hue } from '../components/icons';
import { HoldingSheet } from './Holdings';

const whole = (c: Cents) => formatMoney(c, { whole: true });
const signed = (c: Cents) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${whole(Math.abs(c))}`;
const tone = (c: Cents) => (c > 0 ? 'pos-text' : c < 0 ? 'neg-text' : '');

export const LOOK: Record<InsightKind, { glyph: GlyphName; hue: Hue }> = {
  'long-term': { glyph: 'hourglass', hue: 'blue' },
  loss: { glyph: 'down', hue: 'orange' },
  concentration: { glyph: 'pie', hue: 'violet' },
  cash: { glyph: 'bank', hue: 'green' },
  'below-high': { glyph: 'trend', hue: 'magenta' },
};

/** Opens a holding: in its account, or the one with the most of it. */
function useOpenHolding(p: Portfolio) {
  const nav = useNav();
  const accounts = useAccounts();
  return (ticker: string, accountId?: string) => {
    const id =
      accountId ??
      p.accounts
        .flatMap((hs) => hs.positions)
        .filter((x) => x.ticker === ticker)
        .sort((a, b) => b.value - a.value)[0]?.accountId;
    const account = accounts.find((a) => a.id === id);
    if (account) nav.present((close) => <HoldingSheet account={account} ticker={ticker} onClose={close} />);
  };
}

/** Facts worth a minute, the most pressing first. */
export function WorthALookSection(props: { p: Portfolio }) {
  const insights = useInsights();
  const open = useOpenHolding(props.p);
  if (!insights.length) return null;
  return (
    <Section title="Worth a look" footer="Facts about what you hold, not advice: what to do about them is up to you.">
      {insights.map((i) => {
        const body = (
          <>
            <IconChip name={LOOK[i.kind].glyph} hue={LOOK[i.kind].hue} size="sm" />
            <span class="row-main">
              <span class="row-title">{i.title}</span>
              <span class="row-subtitle">{i.detail}</span>
            </span>
          </>
        );
        return i.ticker ? (
          <button type="button" class="row insight-row" key={i.key} onClick={() => open(i.ticker!, i.accountId)}>
            {body}
            <span class="chevron" aria-hidden="true">
              ›
            </span>
          </button>
        ) : (
          <div class="row insight-row" key={i.key}>
            {body}
          </div>
        );
      })}
    </Section>
  );
}

/** Where the S&P 500 stands: from its high of the last year, and its 200-day average. */
export function MarketSection() {
  const spy = usePrices().get(BENCHMARK);
  const t = useMemo(() => trendOf(spy), [spy]);
  if (!t || !t.fullYear) return null;
  const vsAverage = t.avg200 != null ? t.price / t.avg200 - 1 : undefined;
  return (
    <Section
      title="The market"
      footer="Where the S&P 500 has been, not where it’s going: no one knows that. Down 10% from a high is called a correction, and 20% a bear market. From SPY’s closes."
    >
      <div class="row insight-row">
        <span class="row-main">
          <span class="row-title">{MOOD_LABEL[moodOf(t)]}</span>
          <span class="row-subtitle">
            The S&amp;P 500 is {fromHighText(t)} of the last year
            {moodOf(t) === 'high' ? '' : ` (${formatShortDate(t.highDate)})`}
            {vsAverage != null &&
              `, and ${Math.abs(vsAverage) < 0.005 ? 'at' : `${Math.round(Math.abs(vsAverage) * 100)}% ${vsAverage > 0 ? 'above' : 'below'}`} its average of the last 200 trading days`}
            .
          </span>
        </span>
      </div>
    </Section>
  );
}

interface TaxFacts {
  thisYear: Realized;
  lastYear: Realized;
  dividends: Cents;
  held: ByTerm;
  lots: ReturnType<typeof openLots>;
}

function useTaxFacts(p: Portfolio, accounts: Account[]): TaxFacts | null {
  const today = todayISO();
  return useMemo(() => {
    if (!p.accounts.some((hs) => isTaxable(accounts.find((a) => a.id === hs.accountId)))) return null;
    const year = Number(today.slice(0, 4));
    const lots = openLots(p, accounts, today);
    return {
      thisYear: realizedBetween(p, accounts, `${year}-01-01`, today),
      lastYear: realizedBetween(p, accounts, `${year - 1}-01-01`, `${year - 1}-12-31`),
      dividends: taxableDividends(p, accounts, `${year}-01-01`, today),
      held: unrealized(lots),
      lots,
    };
  }, [p, accounts, today]);
}

/** Taxes at a glance on the Portfolio page (brokerage accounts only). */
export function TaxesSection(props: { p: Portfolio }) {
  const nav = useNav();
  const accounts = useAccounts();
  const facts = useTaxFacts(props.p, accounts);
  if (!facts) return null;
  const open = () => nav.present((close) => <TaxesSheet p={props.p} onClose={close} />);
  const { thisYear, dividends, held } = facts;
  return (
    <Section title="Taxes" footer="In your brokerage accounts: IRAs and 401(k)s aren’t taxed on what you sell.">
      {thisYear.sales > 0 && (
        <Row
          title="Sold this year"
          subtitle={termText(thisYear) || 'No gain or loss'}
          detail={<span class={tone(netGain(thisYear))}>{signed(netGain(thisYear))}</span>}
          onClick={open}
        />
      )}
      {dividends > 0 && <Row title="Dividends this year" subtitle="Taxed this year, reinvested or not" detail={whole(dividends)} onClick={open} />}
      <Row
        title="If you sold it all today"
        subtitle={termText(held) || 'No gain or loss'}
        detail={<span class={tone(netGain(held))}>{signed(netGain(held))}</span>}
        onClick={open}
      />
    </Section>
  );
}

/** Taxes on selling, in full: this year and last, what's held by term, what turns long-term soon, and losses. */
export function TaxesSheet(props: { p: Portfolio; onClose: () => void }) {
  const accounts = useAccounts();
  const facts = useTaxFacts(props.p, accounts);
  const open = useOpenHolding(props.p);
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const soon = useMemo(() => (facts ? turningLongTerm(facts.lots, 60) : []), [facts]);
  const losses = useMemo(() => (facts ? harvestable(props.p, accounts, facts.lots, today) : []), [facts, props.p, accounts, today]);
  if (!facts) return null;
  const { thisYear, lastYear, dividends, held } = facts;
  const byTerm = (t: ByTerm) => (
    <>
      <Row
        title="Short-term"
        subtitle="Held a year or less: taxed like income"
        detail={<span class={tone(t.shortGain)}>{signed(t.shortGain)}</span>}
        chevron={false}
        wrap
      />
      <Row
        title="Long-term"
        subtitle="Held more than a year: taxed at lower rates"
        detail={<span class={tone(t.longGain)}>{signed(t.longGain)}</span>}
        chevron={false}
        wrap
      />
      {t.unknownGain !== 0 && (
        <Row
          title="Term not known yet"
          subtitle="Shares an import started with: long-term a year after it, at the latest"
          detail={<span class={tone(t.unknownGain)}>{signed(t.unknownGain)}</span>}
          chevron={false}
          wrap
        />
      )}
    </>
  );
  return (
    <Sheet title="Taxes" onClose={props.onClose}>
      <Section
        title={`Sold in ${year}`}
        footer={
          thisYear.sales ? `${thisYear.sales} sale${thisYear.sales === 1 ? '' : 's'}, bringing in ${whole(thisYear.proceeds)}.` : 'Nothing sold yet this year.'
        }
      >
        {byTerm(thisYear)}
        {dividends > 0 && <Row title="Dividends" subtitle="Taxed this year, reinvested or not" detail={whole(dividends)} chevron={false} />}
      </Section>
      {lastYear.sales > 0 && <Section title={`Sold in ${year - 1}`}>{byTerm(lastYear)}</Section>}
      <Section title="If you sold it all today" footer="What selling everything at the latest prices would realize.">
        {byTerm(held)}
      </Section>
      {soon.length > 0 && (
        <Section title="Turning long-term soon" footer="Sold on or after that day, these shares’ gains are taxed at the lower long-term rate.">
          {soon.map((t) => (
            <Row
              title={`${t.ticker} · ${formatShortDate(t.on)}, in ${t.days} day${t.days === 1 ? '' : 's'}`}
              subtitle={`${formatShares(t.shares)} shares bought ${formatDate(t.acquired)} · ${t.account.name}`}
              detail={<span class="pos-text">{signed(t.gain)}</span>}
              onClick={() => open(t.ticker, t.account.id)}
              wrap
            />
          ))}
        </Section>
      )}
      {losses.length > 0 && (
        <Section
          title="Below what you paid"
          footer="Selling at a loss realizes it: losses offset gains, then up to $3,000 a year of other income, and the rest carries over to later years. Buying the same within 30 days before or after the sale (in any account, an IRA too) makes it a wash sale, and the loss can’t be claimed then."
        >
          {losses.map((h) => (
            <Row
              title={`${h.ticker} · ${h.account.name}`}
              subtitle={
                h.washBuy
                  ? `Bought in ${h.washBuy.account.name} ${formatShortDate(h.washBuy.date)}: a wash sale before ${formatShortDate(h.washBuy.clearOn)}`
                  : termText(unrealized(facts.lots.filter((l) => l.account.id === h.account.id && l.ticker === h.ticker)))
              }
              detail={<span class="neg-text">{signed(-h.loss)}</span>}
              onClick={() => open(h.ticker, h.account.id)}
              wrap
            />
          ))}
        </Section>
      )}
      <p class="section-footer">
        From what you’ve entered here, not tax advice: your brokerage’s 1099-B is what counts. Sales count the oldest shares first, as brokerages do unless you
        pick others.
      </p>
    </Sheet>
  );
}
