import { describe, expect, it } from 'vitest';
import { accountLines, importedTrades, lineKey, missingLines, readLine, tickersText, tradeFor, tradesText, type Line } from '../src/lib/bankTrades';
import { cleanPayee, merchantName } from '../src/lib/payee';
import { buildPosition } from '../src/lib/holdings';
import type { Account, Trade, Transaction } from '../src/types';

const FXAIX = 'YOU BOUGHT PROSPECTUS UNDER SEPARATE COVER FIDELITY 500 INDEX FUND (FXAIX) (Cash)';
const VTI = 'YOU BOUGHT VANGUARD INDEX FDS VANGUARD TOTAL STK MKT ETF (VTI) (Cash)';

const account = (patch: Partial<Account> = {}): Account => ({
  id: 'brk',
  name: 'Fidelity Brokerage',
  type: 'brokerage',
  institution: 'Fidelity',
  openingBalance: 0,
  archived: false,
  createdAt: 0,
  ...patch,
});

let n = 0;
const txn = (date: string, amount: number, description: string, patch: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId: 'brk',
  date,
  amount,
  description,
  payee: cleanPayee(description),
  categoryId: 'investments',
  notes: '',
  source: 'csv',
  createdAt: n,
  ...patch,
});

const trade = (patch: Partial<Trade>): Trade => ({
  id: `tr${++n}`,
  accountId: 'brk',
  ticker: 'FXAIX',
  date: '2026-09-01',
  kind: 'buy',
  amount: 10000,
  source: 'manual',
  createdAt: n,
  ...patch,
});

/** A periodic investment: $100 of FXAIX each Monday, paid by a transfer from the bank. */
function periodic(): Transaction[] {
  return ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].flatMap((d) => [
    txn(d, 10000, 'Electronic Funds Transfer Received (Cash)'),
    txn(d, -10000, FXAIX),
  ]);
}

const states = (lines: Line[]) => lines.map((l) => `${l.txn.date} ${l.kind} ${l.ticker ?? '?'} ${l.state}`);

describe('reading a trade from a bank line', () => {
  it('reads Fidelity’s purchases and sales, with the ticker and the name', () => {
    expect(readLine(FXAIX, -10000)).toEqual({ kind: 'buy', ticker: 'FXAIX', name: 'FIDELITY 500 INDEX FUND', plain: true });
    expect(readLine(VTI, -55020)).toEqual({ kind: 'buy', ticker: 'VTI', name: 'VANGUARD INDEX FDS VANGUARD TOTAL STK MKT ETF', plain: true });
    expect(readLine('YOU SOLD APPLE INC (AAPL) (Cash)', 100000)).toMatchObject({ kind: 'sell', ticker: 'AAPL' });
    expect(readLine('YOU BOUGHT BERKSHIRE HATHAWAY INC CL B (BRK.B) (Cash)', -40000)).toMatchObject({ ticker: 'BRK.B' });
    // A fund with "dividend" in its name is still bought.
    expect(readLine('YOU BOUGHT SCHWAB STRATEGIC TR US DIVIDEND EQUITY ETF (SCHD) (Cash)', -5000)).toMatchObject({ kind: 'buy', ticker: 'SCHD' });
  });

  it('only with the money going the right way', () => {
    expect(readLine(FXAIX, 10000)).toBeNull();
    expect(readLine('YOU SOLD APPLE INC (AAPL) (Cash)', -100000)).toBeNull();
  });

  it('leaves out reinvested dividends, income, money moving, the cash side, options, bonds and card spending', () => {
    expect(readLine('REINVESTMENT FIDELITY 500 INDEX FUND (FXAIX) (Cash)', -1844)).toBeNull();
    expect(readLine('DIVIDEND RECEIVED FIDELITY 500 INDEX FUND (FXAIX) (Cash)', 1844)).toBeNull();
    expect(readLine('Electronic Funds Transfer Received (Cash)', 10000)).toBeNull();
    expect(readLine('YOU BOUGHT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)', -10000)).toBeNull();
    expect(readLine('PURCHASE INTO CORE ACCOUNT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) MORNING TRADE (Cash)', -10000)).toBeNull();
    expect(readLine('YOU BOUGHT', -10000, 'SPAXX')).toBeNull();
    expect(readLine('YOU BOUGHT OPENING TRANSACTION CALL (AAPL) APPLE INC JAN 17 27 $200 (100 SHS) (Margin)', -50000)).toBeNull();
    expect(readLine('YOU BOUGHT UNITED STATES TREAS BILLS ZERO CPN 0.00000% 01/02/2027', -98000, '912797KX4')).toBeNull();
    expect(readLine('DEBIT CARD PURCHASE WHOLEFDS MKT 10234 BOSTON MA', -6418)).toBeNull();
  });

  it('takes the ticker from the file’s Symbol column first', () => {
    expect(readLine('AUTOMATIC INVESTMENT', -10000, 'vti')).toEqual({ kind: 'buy', ticker: 'VTI', plain: true });
    // An option's symbol isn't a ticker.
    expect(readLine('YOU BOUGHT', -10000, '-SPY270115C500')).toEqual({ kind: 'buy', plain: true });
  });

  it('says when a line plainly is a trade even without a ticker, and when it only might be', () => {
    expect(readLine('PERIODIC INVESTMENT', -10000)).toEqual({ kind: 'buy', plain: true });
    expect(readLine('RECURRING BUY', -2500)).toEqual({ kind: 'buy', plain: true });
    expect(readLine('ONLINE PURCHASE', -2500)).toEqual({ kind: 'buy', plain: false });
  });

  it('keys lines alike by their words, without dates or numbers', () => {
    expect(lineKey('AUTOMATIC INVESTMENT 11/14 REF 4471')).toBe('automatic investment ref');
    expect(lineKey('Automatic Investment 12/12 REF 9918')).toBe('automatic investment ref');
  });
});

describe('a brokerage line’s name', () => {
  it('says what it did and the ticker', () => {
    expect(cleanPayee(FXAIX)).toBe('Bought FXAIX');
    expect(cleanPayee('YOU SOLD AMAZON.COM INC (AMZN) (Cash)')).toBe('Sold AMZN');
    expect(cleanPayee('DIVIDEND RECEIVED VANGUARD INDEX FDS VANGUARD TOTAL STK MKT ETF (VTI) (Cash)')).toBe('Dividend from VTI');
    expect(cleanPayee('REINVESTMENT FIDELITY 500 INDEX FUND (FXAIX) (Cash)')).toBe('Reinvested in FXAIX');
    expect(cleanPayee('YOU BOUGHT OPENING TRANSACTION CALL (AAPL) APPLE INC JAN 17 27 $200 (100 SHS) (Margin)')).toBe('Bought AAPL option');
  });

  it('leaves other lines to the store-name rules', () => {
    expect(cleanPayee('Electronic Funds Transfer Received (Cash)')).toBe(merchantName('Electronic Funds Transfer Received (Cash)'));
    expect(cleanPayee('SQ *BLUE BOTTLE COFFEE  OAKLAND  CA')).toBe('Blue Bottle Coffee');
    // What those rules made of a periodic investment before: cut at the "500", without the fund.
    expect(merchantName(FXAIX)).toBe('You Bought Prospectus Under Separate Cover Fidelity');
  });
});

describe('the trades in an investment account’s lines', () => {
  it('lists each purchase missing from the holdings, and nothing else', () => {
    const lines = accountLines(account(), periodic(), []);
    expect(states(lines)).toEqual([
      '2026-09-07 buy FXAIX missing',
      '2026-09-14 buy FXAIX missing',
      '2026-09-21 buy FXAIX missing',
      '2026-09-28 buy FXAIX missing',
    ]);
    expect(lines[0].name).toBe('FIDELITY 500 INDEX FUND');
  });

  it('only in accounts that can hold stocks', () => {
    expect(accountLines(account({ type: 'checking' }), periodic(), [])).toEqual([]);
    expect(accountLines(account({ type: 'roth-ira' }), periodic(), [])).toHaveLength(4);
  });

  it('counts the ones up to a positions file’s day in it', () => {
    expect(states(accountLines(account({ positionsOn: '2026-09-14' }), periodic(), [])).map((s) => s.split(' ').pop())).toEqual([
      'counted',
      'counted',
      'missing',
      'missing',
    ]);
    // Positions imported before that day was kept: the day of its trades.
    const opening = trade({ date: '2026-09-14', source: 'import', opening: true, shares: 10, amount: 200000 });
    expect(states(accountLines(account(), periodic(), [opening])).map((s) => s.split(' ').pop())).toEqual(['counted', 'counted', 'missing', 'missing']);
  });

  it('knows the ones added from their lines, typed in already, or kept out', () => {
    const txns = periodic();
    const buys = txns.filter((t) => t.amount < 0);
    buys[3].noTrade = true;
    const trades = [
      trade({ date: '2026-09-07', txnId: buys[0].id, source: 'import' }),
      // Typed in a day late, a few cents off: it's the same purchase.
      trade({ date: '2026-09-15', amount: 10003 }),
      // A different amount isn't.
      trade({ date: '2026-09-21', amount: 25000 }),
    ];
    const lines = accountLines(account(), txns, trades);
    expect(states(lines)).toEqual([
      '2026-09-07 buy FXAIX added',
      '2026-09-14 buy FXAIX matched',
      '2026-09-21 buy FXAIX missing',
      '2026-09-28 buy FXAIX kept-out',
    ]);
    expect(lines[0].trade).toBe(trades[0]);
    expect(lines[1].trade).toBe(trades[1]);
  });

  it('matches a typed-in trade to one line only', () => {
    const txns = [txn('2026-09-07', -10000, FXAIX), txn('2026-09-08', -10000, FXAIX)];
    expect(states(accountLines(account(), txns, [trade({ date: '2026-09-07' })])).map((s) => s.split(' ').pop())).toEqual(['matched', 'missing']);
  });

  it('a trade whose line is gone (its duplicate removed) is the line that’s left', () => {
    const txns = [txn('2026-09-07', -10000, FXAIX)];
    expect(accountLines(account(), txns, [trade({ date: '2026-09-07', source: 'import', txnId: 'gone' })])[0].state).toBe('matched');
  });

  it('a sale needs shares to sell from: one of shares bought before the files start waits for that purchase', () => {
    const sale = 'YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Cash)';
    expect(states(accountLines(account(), [txn('2026-09-10', 50000, sale)], []))).toEqual(['2026-09-10 sell FXAIX unheld']);
    // Once that purchase is in, it's a sale like any other.
    expect(states(accountLines(account(), [txn('2026-09-10', 50000, sale)], [trade({ date: '2023-04-03', amount: 30000 })]))).toEqual([
      '2026-09-10 sell FXAIX missing',
    ]);
    expect(states(accountLines(account(), [txn('2026-09-07', -10000, FXAIX), txn('2026-09-10', 5000, sale)], []))).toEqual([
      '2026-09-07 buy FXAIX missing',
      '2026-09-10 sell FXAIX missing',
    ]);
    expect(states(accountLines(account(), [txn('2026-09-10', 5000, sale)], [trade({ date: '2026-08-01' })]))).toEqual(['2026-09-10 sell FXAIX missing']);
  });

  it('finds the stock from a held ticker the line names, or the one you picked for lines like it', () => {
    const txns = [txn('2026-09-07', -10000, 'RECURRING BUY VTI 0907'), txn('2026-09-08', -10000, 'AUTOMATIC INVESTMENT 09/08 REF 1123')];
    expect(states(accountLines(account(), txns, []))).toEqual(['2026-09-07 buy ? missing', '2026-09-08 buy ? missing']);
    const held = [trade({ ticker: 'VTI', date: '2026-08-01' })];
    expect(states(accountLines(account(), txns, held, { 'automatic investment ref': 'FXAIX' }))).toEqual([
      '2026-09-07 buy VTI missing',
      '2026-09-08 buy FXAIX missing',
    ]);
    // "Buy" without a stock named could be anything.
    expect(accountLines(account(), [txn('2026-09-07', -10000, 'ONLINE PURCHASE 0907')], [])).toEqual([]);
  });

  it('uses the file’s shares', () => {
    const t = txn('2026-09-25', -55020, VTI, { security: { ticker: 'VTI', shares: 2 } });
    expect(accountLines(account(), [t], [])[0]).toMatchObject({ ticker: 'VTI', shares: 2 });
  });
});

describe('trades from lines', () => {
  it('a purchase on its day for what it cost, as money put in; a sale’s money kept as cash', () => {
    const [buy, sell] = [
      txn('2026-09-25', -55020, VTI, { security: { ticker: 'VTI', shares: 2 } }),
      txn('2026-09-28', 30000, 'YOU SOLD VANGUARD (VTI) (Cash)'),
    ];
    const lines = accountLines(account(), [buy, sell], []);
    expect(tradeFor(lines[0] as Line & { ticker: string }, 'a', 5)).toEqual({
      id: 'a',
      accountId: 'brk',
      ticker: 'VTI',
      date: '2026-09-25',
      kind: 'buy',
      amount: 55020,
      shares: 2,
      source: 'import',
      txnId: buy.id,
      createdAt: 5,
    });
    expect(tradeFor(lines[1] as Line & { ticker: string }, 'b', 6)).toMatchObject({ kind: 'sell', amount: 30000, cash: true, txnId: sell.id });
  });

  it('an import says which of its sales are of shares bought before the files start', () => {
    const sale = txn('2026-09-20', 115000, 'YOU SOLD APPLE INC (AAPL) (Cash)', { security: { ticker: 'AAPL', shares: 5 } });
    const r = importedTrades({ accounts: [account()], txns: [sale], trades: [trade({ date: '2026-08-01' })], added: new Set([sale.id]) });
    expect(r.add).toEqual([]);
    expect(r.unheld.map((l) => [l.ticker, l.shares, l.state])).toEqual([['AAPL', 5, 'unheld']]);
  });

  it('an import adds them to accounts whose holdings are tracked, for the lines it brought in', () => {
    const txns = periodic();
    const other = account({ id: 'ira', name: 'Roth IRA', type: 'roth-ira' });
    const iraBuy = txn('2026-09-28', -10000, FXAIX, { accountId: 'ira' });
    const unknown = txn('2026-09-28', -2500, 'AUTOMATIC INVESTMENT 09/28', { accountId: 'brk' });
    const all = [...txns, iraBuy, unknown];
    const added = new Set([txns[7].id, iraBuy.id, unknown.id]);
    const tracked = [trade({ date: '2026-08-01' })];
    const { add, waiting } = importedTrades({ accounts: [account(), other], txns: all, trades: tracked, added });
    expect(add.map((l) => [l.txn.id, l.ticker])).toEqual([[txns[7].id, 'FXAIX']]);
    // The IRA has no holdings yet (its value would become just this one), and one line doesn't say its stock.
    expect(waiting.map((l) => l.txn.id).sort()).toEqual([iraBuy.id, unknown.id].sort());
    // Lines from before the import aren't its business.
    expect([...add, ...waiting].some((l) => l.txn.date < '2026-09-28')).toBe(false);
    // What's still missing, account by account, once those are in.
    const missing = missingLines([account(), other], all, [...tracked, tradeFor(add[0], 'x', 1)]);
    expect(missing.get('brk')?.map((l) => l.txn.date)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(missing.get('brk')?.at(-1)?.txn.id).toBe(unknown.id);
    expect(missing.get('ira')?.map((l) => l.txn.date)).toEqual(['2026-09-28']);
  });

  it('says what they are', () => {
    const [buy, sell] = accountLines(
      account(),
      [txn('2026-09-07', -10000, FXAIX), txn('2026-09-10', 5000, 'YOU SOLD FIDELITY 500 INDEX FUND (FXAIX) (Cash)')],
      [],
    );
    expect(tradesText([buy])).toBe('a purchase of FXAIX');
    expect(tradesText([buy, buy])).toBe('2 purchases of FXAIX');
    expect(tradesText([sell])).toBe('a sale of FXAIX');
    expect(tradesText([buy, sell])).toBe('2 trades of FXAIX');
  });

  it('names the stocks', () => {
    expect(tickersText([{ ticker: 'FXAIX' }, { ticker: 'FXAIX' }])).toBe('FXAIX');
    expect(tickersText([{ ticker: 'FXAIX' }, { ticker: 'VTI' }])).toBe('FXAIX and VTI');
    expect(tickersText([{ ticker: 'A' }, { ticker: 'B' }, { ticker: 'C' }, { ticker: 'D' }])).toBe('A, B and 2 more');
  });
});

describe('lines you typed in yourself', () => {
  it('aren’t read as trades (they aren’t from a bank file)', () => {
    expect(accountLines(account(), [txn('2026-09-07', -10000, FXAIX, { source: 'manual' })], [])).toEqual([]);
  });
});

describe('a purchase and a sale on the same day', () => {
  const sold = () => txn('2026-09-18', 36000, 'YOU SOLD NVIDIA CORP (NVDA) (Cash)', { security: { ticker: 'NVDA', shares: 2 } });
  const bought = () => txn('2026-09-18', -35000, 'YOU BOUGHT NVIDIA CORP (NVDA) (Cash)', { security: { ticker: 'NVDA', shares: 2 } });
  const position = (trades: Trade[]) => buildPosition({ accountId: 'brk', ticker: 'NVDA', trades, reinvest: true });

  it('the sale sells what was bought, whichever the file lists first', () => {
    // Fidelity's file lists the newest first: that day's sale above the purchase.
    for (const lines of [
      [sold(), bought()],
      [bought(), sold()],
    ]) {
      const found = accountLines(account(), lines, []);
      expect(states(found)).toEqual(['2026-09-18 buy NVDA missing', '2026-09-18 sell NVDA missing']);
      const p = position(found.map((l, i) => tradeFor(l as Line & { ticker: string }, `x${i}`, i)));
      expect(p.shares).toBe(0);
      expect(p.realized).toBe(1000);
    }
  });

  it('in the holdings too, when the sale went in first', () => {
    const [s, b] = [sold(), bought()];
    const trades = [
      { ...trade({ ticker: 'NVDA', date: '2026-09-18', kind: 'sell', amount: 36000, shares: 2, cash: true, source: 'import', txnId: s.id }), createdAt: 1 },
      { ...trade({ ticker: 'NVDA', date: '2026-09-18', kind: 'buy', amount: 35000, shares: 2, source: 'import', txnId: b.id }), createdAt: 2 },
    ];
    expect(position(trades).shares).toBe(0);
    // Trades you typed in still go in the order you added them.
    const typed = trades.map((t) => ({ ...t, txnId: undefined, source: 'manual' as const }));
    expect(position(typed).oversold).toBe(true);
  });
});
