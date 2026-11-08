import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planImport, readPositions } from '../src/lib/positions';
import { buildAllHoldings, buildPosition } from '../src/lib/holdings';
import { historyFromSeries } from '../src/lib/prices';
import type { Account, Trade } from '../src/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/positions/${name}`, import.meta.url), 'utf8');

describe('reading a positions file', () => {
  it('reads Fidelity’s, with several accounts, the core cash, and what to leave out', () => {
    const f = readPositions(fixture('fidelity.csv'))!;
    expect(f.format).toBe('Fidelity');
    expect(f.asOf).toBe('2026-11-07');
    expect(f.accounts).toEqual(['Z12345678', 'Z87654321']);
    // The option and "Pending Activity" are left out; SPAXX** is the cash.
    expect(f.rows.map((r) => [r.account, r.ticker, r.shares, r.value, r.basis])).toEqual([
      ['Z12345678', 'VTI', 20, 550_200, 460_000],
      ['Z12345678', 'AAPL', 15.5, 356_500, 260_000],
      ['Z12345678', 'FXAIX', 25.123, 490_903, 400_000],
      ['Z87654321', 'FZROX', 100, 201_500, 150_000],
    ]);
    expect([...f.cash]).toEqual([['Z12345678', 123_456]]);
    expect(f.rows[0].name).toBe('VANGUARD INDEX FDS VANGUARD TOTAL STK MKT ETF');
  });

  it('reads Schwab’s, from its title down', () => {
    const f = readPositions(fixture('schwab.csv'))!;
    expect([f.format, f.asOf, f.accounts]).toEqual(['Schwab', '2026-11-06', ['']]);
    expect(f.rows.map((r) => [r.ticker, r.shares, r.value, r.basis])).toEqual([
      ['SCHB', 100, 248_000, 200_000],
      ['MSFT', 5, 210_000, 150_000],
    ]);
    expect(f.cash.get('')).toBe(92_000);
  });

  it('reads Vanguard’s, stopping before its transactions, with money market as cash', () => {
    const f = readPositions(fixture('vanguard.csv'))!;
    expect([f.format, f.asOf]).toEqual(['Vanguard', undefined]);
    expect(f.rows.map((r) => [r.ticker, r.shares, r.value, r.basis])).toEqual([
      ['VTSAX', 50.5, 631_755, undefined],
      ['VBTLX', 100, 98_000, undefined],
    ]);
    expect(f.cash.get('12345678')).toBe(85_025);
  });

  it('isn’t fooled by a bank file', () => {
    expect(readPositions('Date,Description,Amount\n2026-09-01,Coffee,-4.50\n')).toBeNull();
  });
});

const account: Account = { id: 'a', name: 'Brokerage', type: 'brokerage', institution: '', openingBalance: 0, archived: false, createdAt: 0 };

describe('importing it', () => {
  it('buys each new holding at its value that day, keeping its cost basis for the gain', () => {
    const f = readPositions(fixture('schwab.csv'))!;
    const plan = planImport(f.rows, 'a', undefined, '2026-11-06', true);
    expect(plan.map((c) => [c.ticker, c.change, c.trade])).toEqual([
      [
        'SCHB',
        'new',
        { accountId: 'a', date: '2026-11-06', source: 'import', ticker: 'SCHB', kind: 'buy', shares: 100, amount: 248_000, basis: 200_000, opening: true },
      ],
      [
        'MSFT',
        'new',
        { accountId: 'a', date: '2026-11-06', source: 'import', ticker: 'MSFT', kind: 'buy', shares: 5, amount: 210_000, basis: 150_000, opening: true },
      ],
    ]);
    // Without prices it's worth its value, and its gain is against the cost basis.
    const trade = { ...plan[0].trade!, id: 't', createdAt: 0 } as Trade;
    const p = buildPosition({ accountId: 'a', ticker: 'SCHB', trades: [trade], reinvest: true });
    expect([p.value, p.cost, p.gain]).toEqual([248_000, 200_000, 48_000]);
  });

  it('later, buys or sells the difference, and sells what’s gone', () => {
    const closes = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((date) => ({ date, close: 24 }));
    const schb = historyFromSeries('SCHB', { raw: closes, splitAdjusted: closes, all: closes }, { from: '2026-11-02', fetchedAt: Date.parse('2030-01-01') });
    const had: Trade[] = [
      { id: '1', accountId: 'a', ticker: 'SCHB', date: '2026-11-02', kind: 'buy', amount: 192_000, shares: 80, source: 'import', createdAt: 0 },
      { id: '2', accountId: 'a', ticker: 'VTI', date: '2026-11-02', kind: 'buy', amount: 100_000, shares: 4, source: 'manual', createdAt: 1 },
      { id: '3', accountId: 'a', ticker: 'MSFT', date: '2026-11-02', kind: 'buy', amount: 210_000, shares: 5, source: 'import', createdAt: 2 },
    ];
    const hs = buildAllHoldings([account], had, [schb], []).get('a')!;
    const f = readPositions(fixture('schwab.csv'))!;
    const plan = planImport(f.rows, 'a', hs, '2026-11-06', true);
    expect(plan.map((c) => [c.ticker, c.change, c.was, c.now, c.trade?.kind, c.trade?.shares, c.trade?.amount])).toEqual([
      ['SCHB', 'more', 80, 100, 'buy', 20, 49_600],
      ['MSFT', 'same', 5, 5, undefined, undefined, undefined],
      ['VTI', 'gone', 4, 0, 'sell', undefined, 100_000],
    ]);
    expect(planImport(f.rows, 'a', hs, '2026-11-06', false).map((c) => c.ticker)).toEqual(['SCHB', 'MSFT']);
  });

  it('sells a holding bought the same day, even when both were added at the same moment', () => {
    const buy: Trade = { id: 'b', accountId: 'a', ticker: 'VTI', date: '2026-11-06', kind: 'buy', amount: 100_000, shares: 4, source: 'import', createdAt: 5 };
    const sell: Trade = {
      id: 'a',
      accountId: 'a',
      ticker: 'VTI',
      date: '2026-11-06',
      kind: 'sell',
      amount: 100_000,
      all: true,
      source: 'import',
      createdAt: 5,
    };
    expect(buildPosition({ accountId: 'a', ticker: 'VTI', trades: [sell, buy], reinvest: true }).shares).toBe(0);
  });
});
