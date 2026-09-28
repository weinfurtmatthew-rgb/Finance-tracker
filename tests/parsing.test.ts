import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvToDrafts, detectFormat, readCsv } from '../src/lib/csv';
import { parseOfx } from '../src/lib/ofx';
import { parseAmount } from '../src/lib/money';
import { parseBankDate } from '../src/lib/dates';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function importCsv(name: string, accountType?: Parameters<typeof detectFormat>[1]) {
  const table = readCsv(fixture(name));
  const detected = detectFormat(table, accountType);
  return { detected, ...csvToDrafts(table, detected.mapping) };
}

describe('parseAmount', () => {
  it.each([
    ['$1,234.56', 123456],
    ['-12.00', -1200],
    ['(12.00)', -1200],
    ['12.00-', -1200],
    ['-$5', -500],
    ['+5.5', 550],
    ['.99', 99],
    ['', null],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('parseBankDate', () => {
  it.each([
    ['09/28/2026', '2026-09-28'],
    ['9/8/26', '2026-09-08'],
    ['2026-09-28', '2026-09-28'],
    ['20260928120000[-5:EST]', '2026-09-28'],
    ['Sep 28, 2026', '2026-09-28'],
    ['02/31/2026', null],
    ['Run Date', null],
  ])('%s → %s', (input, expected) => {
    expect(parseBankDate(input)).toBe(expected);
  });
});

describe('CSV formats', () => {
  it('Discover: flips signs so purchases are negative', () => {
    const { detected, drafts, skipped } = importCsv('discover.csv');
    expect(detected.format).toBe('Discover');
    expect(skipped).toBe(0);
    expect(drafts).toHaveLength(6);
    expect(drafts[0]).toMatchObject({ date: '2026-09-02', amount: -1549, bankCategory: 'Services' });
    expect(drafts[2].amount).toBe(41233); // payment reduces what you owe
  });

  it('Capital One card: debit/credit columns', () => {
    const { detected, drafts } = importCsv('capitalone-card.csv');
    expect(detected.format).toBe('Capital One (card)');
    expect(drafts.map((d) => d.amount)).toEqual([-645, -645, 25000, -525]);
    expect(drafts[0].date).toBe('2026-09-10');
  });

  it('Capital One 360: unsigned amounts with a Debit/Credit type column', () => {
    const { detected, drafts } = importCsv('capitalone-360.csv');
    expect(detected.format).toBe('Capital One 360');
    expect(drafts.map((d) => d.amount)).toEqual([240000, -5000]);
    expect(drafts[0].description).toBe('Payroll ACME CORP DIR DEP');
  });

  it('Fidelity: finds the header below blank lines and ignores the disclaimer footer', () => {
    const { detected, drafts, skipped } = importCsv('fidelity.csv');
    expect(detected.format).toBe('Fidelity');
    expect(drafts).toHaveLength(3);
    expect(skipped).toBe(2);
    expect(drafts[1]).toMatchObject({ amount: -56020, description: expect.stringContaining('YOU BOUGHT') });
  });

  it('Generic checking file with Withdrawals/Deposits columns', () => {
    const { detected, drafts } = importCsv('generic-checking.csv', 'checking');
    expect(detected.format).toBe('Generic CSV');
    expect(drafts.map((d) => d.amount)).toEqual([-165000, 240000, -5410]);
  });

  it('Generic credit card CSV with positive purchases gets flipped', () => {
    const table = readCsv('Date,Description,Amount\n09/01/2026,COFFEE,4.50\n09/02/2026,LUNCH,12.00\n09/03/2026,PAYMENT,-100.00\n');
    const detected = detectFormat(table, 'credit');
    expect(detected.mapping.invert).toBe(true);
    expect(csvToDrafts(table, detected.mapping).drafts.map((d) => d.amount)).toEqual([-450, -1200, 10000]);
  });
});

describe('OFX', () => {
  it('parses SGML OFX 1.x (QFX) bank statements', () => {
    const [st] = parseOfx(fixture('citizens.qfx'));
    expect(st.kind).toBe('bank');
    expect(st.bankAccountType).toBe('CHECKING');
    expect(st.accountNumber).toBe('000123456789');
    expect(st.balance).toEqual({ amount: 532140, asOf: '2026-09-28' });
    expect(st.transactions).toHaveLength(3);
    expect(st.transactions[0]).toMatchObject({ date: '2026-09-21', amount: -8999, fitid: '2026092101' });
    expect(st.transactions[0].description).toBe('VERIZON WIRELESS PAYMENTS  VZ WIRELESS VE');
    expect(st.transactions[2].description).toBe('DUNKIN #3355 Q35 & CO');
  });

  it('parses XML OFX 2.x credit card statements', () => {
    const [st] = parseOfx(fixture('card-v2.ofx'));
    expect(st.kind).toBe('credit');
    expect(st.balance?.amount).toBe(-81244);
    expect(st.transactions[0]).toMatchObject({ date: '2026-09-11', amount: -1200, description: 'SPOTIFY USA', fitid: 'FIT-1' });
  });
});
