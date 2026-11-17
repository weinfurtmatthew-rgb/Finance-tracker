import { describe, expect, it } from 'vitest';
import { csvToDrafts, detectFormat, looksLikeTransactions, readCsv } from '../src/lib/csv';
import { accountTypeFor, groupBySource, newAccountFor, routeFor, SKIP, splitAccountNumber, tidyName } from '../src/lib/sourceAccounts';
import type { SourceAccount } from '../src/lib/draft';
import type { Account } from '../src/types';

const acct = (id: string, name: string, last4?: string, archived = false): Account => ({
  id,
  name,
  type: 'checking',
  institution: '',
  openingBalance: 0,
  archived,
  createdAt: 0,
  ...(last4 ? { last4 } : {}),
});
const source = (name: string, last4?: string, institution?: string): SourceAccount => ({
  key: `${institution ?? ''}|${name}|${last4 ?? ''}`.toLowerCase(),
  ref: `${institution ?? ''}|${last4 ?? name}`.toLowerCase(),
  label: name,
  name,
  ...(institution ? { institution } : {}),
  ...(last4 ? { last4 } : {}),
});

// Fidelity's Activity & Orders download with "All accounts": blank lines above, notes below.
const NEWER = `

Run Date,Account,Account Number,Action,Symbol,Description,Type,Quantity,Price,Amount,Settlement Date
09/25/2026,"Individual - TOD","Z12345678","YOU BOUGHT VANGUARD TOTAL STK MKT ETF (VTI) (Cash)",VTI,"VANGUARD TOTAL STK MKT ETF",Cash,2,275.10,-550.20,09/26/2026
09/22/2026,"Individual - TOD","Z12345678","DIVIDEND RECEIVED VANGUARD TOTAL STK MKT ETF (VTI) (Cash)",VTI,"VANGUARD TOTAL STK MKT ETF",Cash,0,,18.44,
09/24/2026,"ROTH IRA","238123456","YOU BOUGHT FIDELITY ZERO TOTAL MARKET INDEX FUND (FZROX) (Cash)",FZROX,"FIDELITY ZERO TOTAL MARKET",Cash,20,20.15,-403.00,
09/26/2026,"Cash Management (Individual)","Z98765432","DEBIT CARD PURCHASE WHOLEFDS MKT 10234 BOSTON MA",,"No Description",Cash,0,,-64.18,


"The data and information in this spreadsheet is provided to you solely for your use and is not for distribution."
"Date downloaded 09/29/2026 10:41 am"
`;

// Older downloads: the number at the end of the Account column, no Account Number column.
const OLDER = `Run Date,Account,Action,Symbol,Security Description,Security Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
09/25/2026,INDIVIDUAL Z12345678,YOU BOUGHT VANGUARD TOTAL STK MKT ETF (VTI) (Cash),VTI,VANGUARD TOTAL STK MKT ETF,Cash,2,275.10,,,,-550.20,09/26/2026
09/24/2026,ROTH IRA 238123456,YOU BOUGHT FIDELITY ZERO TOTAL MARKET INDEX FUND (FZROX) (Cash),FZROX,FIDELITY ZERO TOTAL MARKET,Cash,20,20.15,,,,-403.00,
`;

describe('account names and numbers', () => {
  it('splits a number off the end of a name', () => {
    expect(splitAccountNumber('Individual - TOD Z12345678')).toEqual({ name: 'Individual - TOD', number: 'Z12345678' });
    expect(splitAccountNumber('ROTH IRA (238123456)')).toEqual({ name: 'ROTH IRA', number: '238123456' });
    expect(splitAccountNumber('Joint WROS ****5678')).toEqual({ name: 'Joint WROS', number: '****5678' });
    expect(splitAccountNumber('Brokerage 2')).toEqual({ name: 'Brokerage 2', number: '' });
    expect(splitAccountNumber('Z12345678')).toEqual({ name: 'Z12345678', number: '' });
  });
  it('tidies names written in capitals, keeping acronyms', () => {
    expect(tidyName('ROTH IRA')).toBe('Roth IRA');
    expect(tidyName('INDIVIDUAL - TOD')).toBe('Individual - TOD');
    expect(tidyName('Cash Management (Individual)')).toBe('Cash Management (Individual)');
  });
  it('a type from the name, with a fallback for the bank', () => {
    expect(accountTypeFor(source('Individual - TOD'), 'brokerage')).toBe('brokerage');
    expect(accountTypeFor(source('ROTH IRA'), 'brokerage')).toBe('roth-ira');
    expect(accountTypeFor(source('Traditional IRA'), 'brokerage')).toBe('ira');
    expect(accountTypeFor(source('Cash Management (Individual)'), 'brokerage')).toBe('checking');
    expect(accountTypeFor(source('Visa Signature Credit Card'))).toBe('credit');
  });
  it('a new account is named for its bank, unless the name has it already', () => {
    expect(newAccountFor(source('INDIVIDUAL - TOD', '5678', 'Fidelity'), 'brokerage')).toEqual({
      name: 'Fidelity Individual - TOD',
      type: 'brokerage',
      institution: 'Fidelity',
    });
    expect(newAccountFor(source('Citizens Checking', '6789', 'Citizens'))).toEqual({ name: 'Citizens Checking', type: 'checking', institution: 'Citizens' });
  });
});

describe('where an account in a file goes', () => {
  const accounts = [acct('brk', 'Fidelity Brokerage', '5678'), acct('old', 'Old Account', '1111', true), acct('chk', 'Everyday Checking')];
  it('where it went last time first, then the same last 4 digits, then the same name', () => {
    expect(routeFor(source('Individual', '5678', 'Fidelity'), accounts, {})).toBe('brk');
    expect(routeFor(source('Everyday Checking'), accounts, {})).toBe('chk');
    expect(routeFor(source('Something Else', '9999'), accounts, {})).toBeUndefined();
    const roth = source('Roth IRA', '3456', 'Fidelity');
    expect(routeFor(roth, accounts, { [roth.ref!]: 'chk' })).toBe('chk');
    expect(routeFor(roth, accounts, { [roth.ref!]: SKIP })).toBe(SKIP);
    // An account that's gone (or hidden) since: back to matching.
    expect(routeFor(source('Individual', '5678', 'Fidelity'), accounts, { 'fidelity|5678': 'old' })).toBe('brk');
  });
});

describe('Fidelity activity with every account in one file', () => {
  it('reads each row’s account from the Account and Account Number columns', () => {
    const table = readCsv(NEWER);
    expect(looksLikeTransactions(table)).toBe(true);
    const detected = detectFormat(table);
    expect(detected.format).toBe('Fidelity');
    const { drafts, skipped } = csvToDrafts(table, detected.mapping);
    expect(drafts).toHaveLength(4);
    expect(skipped).toBe(2); // the notes under the rows
    const groups = groupBySource(drafts);
    expect(groups.map((g) => [g.account.label, g.drafts.length])).toEqual([
      ['Fidelity · Individual - TOD ••5678', 2],
      ['Fidelity · ROTH IRA ••3456', 1],
      ['Fidelity · Cash Management (Individual) ••5432', 1],
    ]);
    expect(groups[0].account).toMatchObject({ institution: 'Fidelity', last4: '5678', ref: 'fidelity|z12345678' });
    expect(groups[0].drafts[0]).toMatchObject({ date: '2026-09-25', amount: -55020 });
  });
  it('and from a number at the end of the Account column in older files', () => {
    const table = readCsv(OLDER);
    const groups = groupBySource(csvToDrafts(table, detectFormat(table).mapping).drafts);
    expect(groups.map((g) => [g.account.name, g.account.last4, g.account.ref])).toEqual([
      ['INDIVIDUAL', '5678', 'fidelity|z12345678'],
      ['ROTH IRA', '3456', 'fidelity|238123456'],
    ]);
  });
  it('a file from one account only is one group', () => {
    const one = NEWER.split('\n')
      .filter((l) => !l.includes('ROTH') && !l.includes('Cash Management'))
      .join('\n');
    const table = readCsv(one);
    expect(groupBySource(csvToDrafts(table, detectFormat(table).mapping).drafts)).toHaveLength(1);
  });
});

describe('other files with an account column', () => {
  it('an aggregator’s export (Monarch, Empower…) splits by its Account column', () => {
    const table = readCsv(`Date,Merchant,Category,Account,Original Statement,Notes,Amount
2026-09-25,Whole Foods,Groceries,Chase Sapphire (...4321),WHOLEFDS MKT,,-64.18
2026-09-24,Acme Corp,Paychecks,Ally Checking (...8765),ACME PAYROLL,,2400.00
2026-09-23,Shell,Gas,Chase Sapphire (...4321),SHELL OIL,,-41.20
`);
    const groups = groupBySource(csvToDrafts(table, detectFormat(table).mapping).drafts);
    expect(groups.map((g) => [g.account.name, g.account.last4, g.drafts.length])).toEqual([
      ['Chase Sapphire', '4321', 2],
      ['Ally Checking', '8765', 1],
    ]);
  });
  it('a positions file isn’t mistaken for transactions', () => {
    const table = readCsv(`Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value
Z12345678,Individual,VTI,VANGUARD TOTAL STK MKT ETF,20,$275.10,$5502.00
`);
    expect(looksLikeTransactions(table)).toBe(false);
  });
});
