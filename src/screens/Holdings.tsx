/**
 * Stocks, ETFs and funds inside an investment account: what's held and what it's worth, adding a
 * purchase or sale (how much and when is enough with prices on), and the account's cash.
 */
import { useEffect, useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useAccounts, useMeta } from '../hooks';
import { useNav } from '../nav';
import type { Account, ISODate, Security, Trade } from '../types';
import { useHoldings, usePrices, useSecurities } from '../portfolioModel';
import { cashOn, formatPrice, formatShares, heldPositions, normalizeTicker, sharesOn, tradeShares, type Holdings, type Position } from '../lib/holdings';
import { closeOn, indexOn, splitFactorAfter, type PriceHistory } from '../lib/prices';
import { PRICE_PROBLEMS, searchTickers, TWELVE_DATA_KEY, type PriceErrorKind, type TickerMatch } from '../lib/twelveData';
import { formatDate, formatShortDate, todayISO } from '../lib/dates';
import { formatMoney, parseUserAmount } from '../lib/money';
import { ActionSheet, Field, Row, Section, Segmented, Sheet, Toggle } from '../components/ui';
import { CountUp } from '../components/motion';
import { StockPricesSheet } from './StockPrices';
import { pricesFor } from '../priceSync';
import { KINDS, SECTORS, isStock, kindOf, sectorOf } from '../lib/mix';

const whole = (c: number) => formatMoney(c, { whole: true });
const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatMoney(Math.abs(c))}`;
const pct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;

/** Why a ticker has no prices from the price service (with a key): on their way, or it doesn't have them. */
function priceProblem(h: PriceHistory | undefined): string | undefined {
  if (!h) return 'Its prices are on their way.';
  if (!h.dates.length) return PRICE_PROBLEMS[(h.error as PriceErrorKind) ?? 'other'] ?? PRICE_PROBLEMS.other;
  return undefined;
}

/** How a holding without the price service's prices is valued, and what would change that. */
function valuedNote(p: Position, h: PriceHistory | undefined, hasKey: boolean): string | undefined {
  if (p.source === 'market') return undefined;
  if (p.source === 'manual') {
    return hasKey
      ? priceProblem(h)
      : 'Without a price key, it’s valued at the prices you enter. Add a free key in Settings → Stock Prices to get them automatically.';
  }
  const why = 'Its value is what you put in, because its shares aren’t known yet.';
  if (!hasKey) return `${why} Add the shares to its buys to value it at prices you enter, or add a free price key in Settings → Stock Prices.`;
  const problem = priceProblem(h);
  return h && !h.dates.length ? `${why} ${problem} Add the shares to its buys to value it at prices you enter.` : `${why} ${problem}`;
}

/** "12.3456 shares · $242.53" or why it's valued another way. */
function positionLine(p: Position): string {
  if (p.source === 'cost') return 'valued at what you put in';
  if (!p.shares) return 'sold';
  return `${formatShares(p.shares)} shares · ${formatPrice(p.price!)}`;
}

/** An investment account's holdings, on its page. */
export function HoldingsSection(props: { account: Account }) {
  const nav = useNav();
  const a = props.account;
  const hs = useHoldings().get(a.id);
  const securities = useSecurities();
  const hasKey = !!useMeta<string>(TWELVE_DATA_KEY);
  const add = () => nav.present((close) => <TradeSheet account={a} onClose={close} />);
  const open = (p: Position) => nav.present((close) => <HoldingSheet account={a} ticker={p.ticker} onClose={close} />);
  const setUpPrices = () => nav.present((close) => <StockPricesSheet onClose={close} />);

  if (!hs) {
    return (
      <Section
        title="Holdings"
        footer={
          hasKey
            ? 'Add the stocks, ETFs and funds in this account: how much you put in and when is enough. Prices come from Twelve Data, and its value follows them.'
            : 'Add the stocks, ETFs and funds in this account, and its value follows their prices. With a free price key (Settings → Stock Prices), how much you put in and when is enough.'
        }
      >
        <button type="button" class="row link-row" onClick={add}>
          Add a Stock, ETF or Fund
        </button>
        {!hasKey && (
          <button type="button" class="row link-row" onClick={setUpPrices}>
            Turn On Stock Prices
          </button>
        )}
      </Section>
    );
  }

  const held = heldPositions(hs);
  const sold = hs.positions.filter((p) => !held.includes(p));
  const cash = cashOn(hs);
  const asOf = hs.positions
    .map((p) => (p.source === 'market' ? p.priceDate : undefined))
    .filter(Boolean)
    .sort()
    .at(-1);
  return (
    <Section
      title={
        <>
          <span>Holdings</span>
          <button type="button" class="link" onClick={add}>
            Add
          </button>
        </>
      }
      footer={[
        'Its value is its holdings plus its cash.',
        asOf && `Prices from Twelve Data, as of the close ${formatShortDate(asOf)}.`,
        !hasKey && 'Add a free price key in Settings → Stock Prices to value them at market prices.',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {held.map((p) => (
        <HoldingRow p={p} name={securities.get(p.ticker)?.name} onClick={() => open(p)} />
      ))}
      <Row
        title="Cash"
        subtitle={a.cash ? `entered ${formatShortDate(a.cash.date)}` : 'not entered'}
        detail={whole(cash)}
        onClick={() => nav.present((close) => <CashSheet account={a} onClose={close} />)}
      />
      {sold.map((p) => (
        <Row title={p.ticker} subtitle={`sold · ${signed(p.realized)} gain`} detail={whole(0)} onClick={() => open(p)} />
      ))}
      {!hasKey && (
        <button type="button" class="row link-row" onClick={setUpPrices}>
          Turn On Stock Prices
        </button>
      )}
    </Section>
  );
}

function HoldingRow(props: { p: Position; name?: string; onClick: () => void }) {
  const { p } = props;
  return (
    <button type="button" class="row holding-row" onClick={props.onClick}>
      <span class="row-main">
        <span class="row-title holding-title">
          <b>{p.ticker}</b>
          {props.name && props.name !== p.ticker && <span class="holding-name">{props.name}</span>}
        </span>
        <span class="row-subtitle">{positionLine(p)}</span>
      </span>
      <span class="row-detail holding-detail">
        <span class="money">{whole(p.value)}</span>
        {p.source !== 'cost' && (
          <span class={`small ${p.gain > 0 ? 'pos-text' : p.gain < 0 ? 'neg-text' : 'muted'}`}>{pct(p.cost > 0 ? p.gain / p.cost : 0)}</span>
        )}
      </span>
      <span class="chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** One holding up close: what it's worth, what it cost, its dividends and its trades. */
export function HoldingSheet(props: { account: Account; ticker: string; onClose: () => void }) {
  const nav = useNav();
  const a = useAccounts().find((x) => x.id === props.account.id) ?? props.account;
  const hs = useHoldings().get(a.id);
  const p = hs?.positions.find((x) => x.ticker === props.ticker);
  const security = useSecurities().get(props.ticker);
  const h = usePrices().get(props.ticker);
  const hasKey = !!useMeta<string>(TWELVE_DATA_KEY);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Its trades deleted: nothing left to show.
  useEffect(() => {
    if (!p) props.onClose();
  }, [p]);
  if (!p) return null;

  const reinvest = !(a.cashDividends ?? []).includes(p.ticker);
  const setReinvest = (on: boolean) => {
    const rest = (a.cashDividends ?? []).filter((t) => t !== p.ticker);
    void db.accounts.update(a.id, { cashDividends: on ? (rest.length ? rest : undefined) : [...rest, p.ticker] });
  };
  const trade = (kind: Trade['kind']) => nav.present((close) => <TradeSheet account={a} ticker={p.ticker} kind={kind} onClose={close} />);
  const note = valuedNote(p, h, hasKey);
  const tone = p.gain > 0 ? 'pos-text' : p.gain < 0 ? 'neg-text' : '';
  const remove = async () => {
    await db.trades.bulkDelete(p.trades.map((t) => t.id));
    nav.toast(`${p.ticker} deleted`);
    props.onClose();
  };
  const held = p.source === 'cost' ? p.value > 0 : (p.shares ?? 0) > 0;

  return (
    <Sheet title={p.ticker} onClose={props.onClose}>
      <section class="card lit detail-hero-card" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 14%, transparent)' }}>
        <span class="card-label">{security?.name ?? p.ticker}</span>
        <CountUp class="detail-big num" value={p.value} format={(c) => formatMoney(c)} />
        <span class="card-sub">
          {[
            p.source === 'cost' ? 'valued at what you put in' : held ? `${formatShares(p.shares!)} shares at ${formatPrice(p.price!)}` : 'all sold',
            p.source === 'market' && p.priceDate && `close ${formatShortDate(p.priceDate)}`,
            p.source === 'manual' && p.priceDate && `price from ${formatShortDate(p.priceDate)}`,
            security?.type ?? h?.type,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {p.source !== 'cost' && held && (
          <span class="cd-facts">
            <span>
              <span class="card-sub">Cost</span>
              <b class="num">{whole(p.cost)}</b>
            </span>
            <span>
              <span class="card-sub">Gain</span>
              <b class={`num ${tone}`}>
                {p.gain > 0 ? '+' : p.gain < 0 ? '−' : ''}
                {whole(Math.abs(p.gain))}
              </b>
              {p.cost > 0 && <span class={`small num ${tone}`}>{pct(p.gain / p.cost)}</span>}
            </span>
            {p.dividends > 0 && (
              <span>
                <span class="card-sub">Dividends</span>
                <b class="num">{whole(p.dividends)}</b>
              </span>
            )}
          </span>
        )}
      </section>
      <div class="button-pair">
        <button type="button" class="button" onClick={() => trade('buy')}>
          Buy
        </button>
        {held && (
          <button type="button" class="button" onClick={() => trade('sell')}>
            Sell
          </button>
        )}
      </div>
      {note && <p class="section-footer">{note}</p>}
      {p.oversold && (
        <p class="callout warn">A sale here is for more shares than were held then; only what was held is counted. Check its shares or the buys before it.</p>
      )}
      {p.source === 'manual' && <ManualPrice ticker={p.ticker} security={security} />}

      <Section title="Trades" footer={p.realized !== 0 ? `Gain on shares sold: ${signed(p.realized)}.` : undefined}>
        {[...p.trades].reverse().map((t) => (
          <Row
            title={`${t.kind === 'buy' ? 'Bought' : 'Sold'} ${formatMoney(t.amount)}`}
            subtitle={[formatDate(t.date), tradeDetail(t, p, h), t.cash && (t.kind === 'buy' ? 'from cash' : 'kept as cash')].filter(Boolean).join(' · ')}
            onClick={() => nav.present((close) => <TradeSheet account={a} ticker={p.ticker} trade={t} onClose={close} />)}
          />
        ))}
      </Section>

      {p.source === 'market' && (
        <Section
          title="Dividends"
          footer={
            reinvest
              ? 'Each dividend buys more shares at that day’s close, as most brokerages do when you choose to reinvest.'
              : 'Dividends are paid into this account’s cash.'
          }
        >
          <Toggle label="Reinvest dividends" checked={reinvest} onChange={setReinvest} />
          {[...p.paid]
            .reverse()
            .slice(0, 8)
            .map((d) => (
              <Row
                title={formatDate(d.date)}
                subtitle={`${formatPrice(d.perShare)} a share${d.bought ? ` · bought ${formatShares(d.bought)} shares` : ''}`}
                detail={formatMoney(d.amount)}
                chevron={false}
              />
            ))}
        </Section>
      )}

      <Section title="Mix" footer="For the mix on the Portfolio page: what it holds, and a company’s sector.">
        <KindFields ticker={p.ticker} security={security} />
      </Section>

      <Section>
        <button type="button" class="row danger-row" onClick={() => setConfirmDelete(true)}>
          Delete {p.ticker}
        </button>
      </Section>
      {confirmDelete && (
        <ActionSheet
          message={`Delete ${p.ticker} and its ${p.trades.length} trade${p.trades.length === 1 ? '' : 's'} from ${a.name}?`}
          actions={[{ label: `Delete ${p.ticker}`, destructive: true, onClick: remove }]}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}

/** "4.1234 shares at $242.53" for a trade, as it was that day. */
function tradeDetail(t: Trade, p: Position, h?: PriceHistory): string | undefined {
  if (t.all && t.kind === 'sell') return 'all of it';
  const traded = t.shares ?? (p.source === 'market' && h ? tradeShares(t, h)! / splitFactorAfter(h, t.date) : undefined);
  return traded ? `${formatShares(traded)} shares at ${formatPrice(t.amount / 100 / traded)}` : undefined;
}

/** Typing a price for a ticker the price service doesn't have. */
function ManualPrice(props: { ticker: string; security?: Security }) {
  const nav = useNav();
  const today = todayISO();
  const last = props.security?.manualPrices?.at(-1);
  const [text, setText] = useState('');
  const price = Number(text.replace(/[$,\s]/g, ''));
  const valid = Number.isFinite(price) && price > 0;
  const save = async () => {
    if (!valid) return;
    const prices = [...(props.security?.manualPrices ?? []).filter((x) => x.date !== today), { date: today, price }];
    const existing = await db.securities.get(props.ticker);
    if (existing) await db.securities.update(props.ticker, { manualPrices: prices });
    else await db.securities.put({ ticker: props.ticker, name: props.ticker, manualPrices: prices });
    setText('');
    nav.toast('Price saved');
  };
  return (
    <Section
      title="Price"
      footer={`The price per share today, from your brokerage. Until you enter one, it’s valued at the price you last paid.${
        last ? ` Last entered: ${formatPrice(last.price)} on ${formatShortDate(last.date)}.` : ''
      }`}
    >
      <Field label="Price today">
        <input
          inputMode="decimal"
          value={text}
          placeholder={last ? formatPrice(last.price) : '0.00'}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
      </Field>
      <button type="button" class="row link-row" disabled={!valid} onClick={() => void save()}>
        Save Price
      </button>
    </Section>
  );
}

/** Adding (or changing) a purchase or a sale. */
export function TradeSheet(props: { account: Account; ticker?: string; kind?: Trade['kind']; trade?: Trade; onClose: () => void }) {
  const nav = useNav();
  const a = props.account;
  const t = props.trade;
  const today = todayISO();
  const hs = useHoldings().get(a.id);
  const prices = usePrices();
  const securities = useSecurities();
  const hasKey = !!useMeta<string>(TWELVE_DATA_KEY);
  const [ticker, setTicker] = useState(props.ticker ?? t?.ticker ?? '');
  const [picked, setPicked] = useState<TickerMatch | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Trade['kind']>(t?.kind ?? props.kind ?? 'buy');
  const [amount, setAmount] = useState(t ? (t.amount / 100).toFixed(2) : '');
  const [date, setDate] = useState(t?.date ?? today);
  const [knowShares, setKnowShares] = useState(t?.shares != null);
  const [sharesText, setSharesText] = useState(t?.shares != null ? String(t.shares) : '');
  const [all, setAll] = useState(!!t?.all);
  const [cash, setCash] = useState(t ? !!t.cash : (props.kind ?? 'buy') === 'sell');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const symbol = normalizeTicker(ticker);
  const fixedTicker = !!(props.ticker ?? t);
  const h = prices.get(symbol);
  const history = h?.dates.length ? h : undefined;
  const known = securities.get(symbol);
  const cents = parseUserAmount(amount) ?? 0;
  const shares = knowShares ? Number(sharesText.replace(/[,\s]/g, '')) : undefined;
  const sharesOk = !knowShares || (Number.isFinite(shares) && shares! > 0);
  const position = hs?.positions.find((p) => p.ticker === symbol);
  // What's held on that day, for a new sale of all of it.
  const heldThen = !t && position && position.source !== 'cost' ? sharesOn(position, date) : undefined;
  const valid = !!symbol && cents > 0 && !!date && date <= today && sharesOk && (kind === 'buy' || !!position || !!t);

  // Matches for what's typed, from the price service (no key needed, nothing else sent).
  const [matches, setMatches] = useState<TickerMatch[]>([]);
  useEffect(() => {
    if (fixedTicker || !hasKey || !ticker.trim() || picked?.ticker === symbol) {
      setMatches([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      searchTickers(ticker)
        .then((m) => live && setMatches(m))
        .catch(() => live && setMatches([]));
    }, 350);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [ticker, hasKey, fixedTicker, picked]);

  // A ticker picked (or this holding's): its prices, for what the trade comes to.
  const [fetching, setFetching] = useState(false);
  useEffect(() => {
    if (!hasKey || !symbol || !(picked || fixedTicker) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return;
    let live = true;
    const id = setTimeout(() => {
      setFetching(true);
      void pricesFor(symbol, date).finally(() => live && setFetching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [hasKey, symbol, picked, fixedTicker, date]);

  // What it comes to: the shares that day's close buys, and what a split since makes of them.
  const preview = (() => {
    if (!symbol || !date) return undefined;
    if (kind === 'sell' && all) return heldThen != null ? `All ${formatShares(heldThen)} shares.` : undefined;
    // Prices for an earlier day than the ones here are on their way.
    if (fetching && history && date < history.dates[0]) return `Getting prices for ${symbol}…`;
    if (!history) {
      if (knowShares && shares! > 0 && cents > 0) return `${formatPrice(cents / 100 / shares!)} a share.`;
      if (!hasKey) return 'Without a price key, add the shares too (or it’s valued at what you put in).';
      if (fetching) return `Getting prices for ${symbol}…`;
      if (h && !h.dates.length)
        return `${PRICE_PROBLEMS[(h.error as PriceErrorKind) ?? 'other'] ?? PRICE_PROBLEMS.other} Add the shares to value it at prices you enter.`;
      return 'The shares are worked out from that day’s price once its prices are downloaded.';
    }
    const close = closeOn(history, date) ?? history.close[0];
    const factor = splitFactorAfter(history, date);
    const thenShares = knowShares ? shares! : cents / 100 / (close * factor);
    if (!(thenShares > 0) || !Number.isFinite(thenShares)) return undefined;
    const line = knowShares
      ? `${formatPrice(cents / 100 / thenShares)} a share; it closed at ${formatPrice(close * factor)} that day.`
      : `About ${formatShares(thenShares)} shares at ${formatPrice(close * factor)}, the close on ${formatShortDate(history.dates[Math.max(0, indexOn(history.dates, date))])}.`;
    const split = history.splits.filter((s) => s.date > date);
    return split.length
      ? `${line} After ${split.length === 1 ? `its ${splitText(split[0].factor)} split on ${formatShortDate(split[0].date)}` : `${split.length} splits since`}, that’s ${formatShares(thenShares * factor)} shares today.`
      : line;
  })();

  const save = async () => {
    if (!valid) return;
    const record: Trade = {
      id: t?.id ?? newId(),
      accountId: a.id,
      ticker: symbol,
      date,
      kind,
      amount: cents,
      ...(knowShares && shares! > 0 && !(kind === 'sell' && all) ? { shares } : {}),
      ...(kind === 'sell' && all ? { all: true } : {}),
      ...(cash ? { cash: true } : {}),
      source: t?.source ?? 'manual',
      createdAt: t?.createdAt ?? Date.now(),
    };
    await db.transaction('rw', db.trades, db.securities, async () => {
      await db.trades.put(record);
      if (!known) {
        await db.securities.put({
          ticker: symbol,
          name: name.trim() || picked?.name || symbol,
          ...(picked?.type ? { type: picked.type } : {}),
        });
      }
    });
    nav.toast(t ? 'Trade saved' : kind === 'buy' ? `${symbol} added` : `Sale of ${symbol} added`);
    props.onClose();
  };
  const remove = async () => {
    await db.trades.delete(t!.id);
    nav.toast('Trade deleted');
    props.onClose();
  };

  return (
    <Sheet
      title={t ? 'Edit Trade' : kind === 'buy' ? (props.ticker ? `Buy ${props.ticker}` : 'Add Holding') : `Sell ${symbol}`}
      onClose={props.onClose}
      onSave={save}
      saveDisabled={!valid}
    >
      {!fixedTicker && (
        <Section
          footer={
            hasKey
              ? 'Type a ticker or a name: US stocks, ETFs and mutual funds the free plan covers show up. For anything else, type its ticker.'
              : 'Its ticker symbol, like VTI or AAPL, as your brokerage shows it.'
          }
        >
          <Field label="Ticker">
            <input
              value={ticker}
              placeholder={hasKey ? 'e.g. VTI or Apple' : 'e.g. VTI'}
              autoCapitalize="characters"
              autoComplete="off"
              spellcheck={false}
              onInput={(e) => {
                setTicker((e.target as HTMLInputElement).value);
                setPicked(null);
              }}
              autoFocus
            />
          </Field>
          {matches.map((m) => (
            <button
              type="button"
              class="row"
              onClick={() => {
                setPicked(m);
                setTicker(m.ticker);
                setMatches([]);
              }}
            >
              <span class="row-main">
                <span class="row-title holding-title">
                  <b>{m.ticker}</b>
                  <span class="holding-name">{m.name}</span>
                </span>
                <span class="row-subtitle">
                  {m.type} · {m.exchange}
                </span>
              </span>
            </button>
          ))}
          {symbol && !known && !picked && (
            <Field label="Name">
              <input value={name} placeholder="Optional" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </Field>
          )}
          {picked && <div class="row muted small">{picked.name}</div>}
        </Section>
      )}
      {(t || props.kind == null) && fixedTicker && (
        <Segmented
          value={kind}
          options={[
            { value: 'buy', label: 'Bought' },
            { value: 'sell', label: 'Sold' },
          ]}
          onChange={(k) => {
            setKind(k);
            if (!t) setCash(k === 'sell');
          }}
        />
      )}
      <Section footer={preview}>
        <Field label="Amount" hint={kind === 'buy' ? 'What you put in' : 'What the sale brought in'}>
          <input
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
            autoFocus={fixedTicker && !t}
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} max={today} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
        {kind === 'sell' && <Toggle label="Sold all of it" checked={all} onChange={setAll} />}
        {!(kind === 'sell' && all) && <Toggle label="I know the shares" checked={knowShares} onChange={setKnowShares} />}
        {knowShares && !(kind === 'sell' && all) && (
          <Field label="Shares" hint="As they were that day">
            <input inputMode="decimal" value={sharesText} placeholder="e.g. 10" onInput={(e) => setSharesText((e.target as HTMLInputElement).value)} />
          </Field>
        )}
      </Section>
      <Section
        footer={
          kind === 'buy'
            ? cash
              ? 'Paid for with cash already in this account, so its value doesn’t change.'
              : 'New money put into this account.'
            : cash
              ? 'The money stays in this account as cash.'
              : 'The money left this account (to your bank, say).'
        }
      >
        <Toggle label={kind === 'buy' ? 'Paid with cash in this account' : 'Kept in this account as cash'} checked={cash} onChange={setCash} />
      </Section>
      {t && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => setConfirmDelete(true)}>
            Delete Trade
          </button>
        </Section>
      )}
      {confirmDelete && (
        <ActionSheet
          message="Delete this trade?"
          actions={[{ label: 'Delete Trade', destructive: true, onClick: remove }]}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}

/** "4-for-1", "1-for-10" */
function splitText(f: number): string {
  if (f >= 1) return `${Math.round(f * 100) / 100}-for-1`;
  return `1-for-${Math.round((1 / f) * 100) / 100}`;
}

/** The cash in an investment account, as the brokerage shows it. */
export function CashSheet(props: { account: Account; onClose: () => void }) {
  const nav = useNav();
  const a = props.account;
  const hs = useHoldings().get(a.id);
  const today = todayISO();
  const [text, setText] = useState(a.cash ? (a.cash.amount / 100).toFixed(2) : hs ? (cashOn(hs) / 100).toFixed(2) : '');
  const [date, setDate] = useState<ISODate>(today);
  const cents = parseUserAmount(text);
  const valid = cents != null && !!date && date <= today;
  const save = async () => {
    if (!valid) return;
    await db.accounts.update(a.id, { cash: { amount: cents!, date } });
    nav.toast('Cash saved');
    props.onClose();
  };
  return (
    <Sheet title="Cash" onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <Section footer="The cash (or money market “core position”) your brokerage shows in this account. Sales you keep in the account, dividends paid out and buys made with cash move it on from there.">
        <Field label="Cash">
          <input inputMode="decimal" value={text} placeholder="0.00" onInput={(e) => setText((e.target as HTMLInputElement).value)} autoFocus />
        </Field>
        <Field label="As of">
          <input type="date" value={date} max={today} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
    </Sheet>
  );
}

/** "3 holdings · close Nov 6", for an account in lists. */
export function holdingsSummary(hs: Holdings): string {
  const held = heldPositions(hs);
  const asOf = held
    .map((p) => (p.source === 'market' ? p.priceDate : undefined))
    .filter(Boolean)
    .sort()
    .at(-1);
  return [`${held.length} holding${held.length === 1 ? '' : 's'}`, asOf && `prices ${formatShortDate(asOf)}`].filter(Boolean).join(' · ');
}

const saveSecurity = async (ticker: string, changes: Partial<Security>) => {
  const s = await db.securities.get(ticker);
  if (s) await db.securities.update(ticker, changes);
  else await db.securities.put({ ticker, name: ticker, ...changes });
};

/** A holding's kind, and its sector when it's a company. */
export function KindFields(props: { ticker: string; security?: Security; label?: string }) {
  const { ticker, security } = props;
  const kind = kindOf(ticker, security);
  const stock = isStock(security, ticker);
  const sector = sectorOf(ticker, security);
  return (
    <>
      <Field label={props.label ?? 'Holds'}>
        <select
          value={kind ?? ''}
          onChange={(e) => void saveSecurity(ticker, { kind: (e.target as HTMLSelectElement).value || undefined })}
          aria-label={`What ${ticker} holds`}
        >
          {!kind && <option value="">Not set</option>}
          {KINDS.map((k) => (
            <option value={k.value}>{k.label}</option>
          ))}
        </select>
      </Field>
      {stock && (
        <Field label={props.label ? `${props.label} sector` : 'Sector'}>
          <select
            value={sector ?? ''}
            onChange={(e) => void saveSecurity(ticker, { sector: (e.target as HTMLSelectElement).value || undefined })}
            aria-label={`${ticker}’s sector`}
          >
            {!sector && <option value="">Not set</option>}
            {SECTORS.map((s) => (
              <option value={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
