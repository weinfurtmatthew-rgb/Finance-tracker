import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bankLineApp,
  categoryFromNote,
  isAppTransferLine,
  linkWaitingPayments,
  paybackMatches,
  people,
  personFromBankLine,
  personName,
  placeAppTransactions,
  readPaymentApp,
  samePerson,
  unexplainedAppPayments,
} from '../src/lib/p2p';
import { prepareImport, toTransactions } from '../src/lib/importer';
import { categorize } from '../src/lib/categorize';
import type { Account, Transaction } from '../src/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const acct = (id: string, type: Account['type']): Account => ({ id, name: id, type, institution: '', openingBalance: 0, archived: false, createdAt: 0 });
let n = 0;
const newId = () => `new${n++}`;
const tx = (accountId: string, date: string, amount: number, description: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId, date, amount, description, payee: description, categoryId: 'uncategorized', categorySource: 'default', notes: '', source: 'csv', createdAt: 0, ...extra,
});
const walletRows = (file: string, accountId = 'venmo') => {
  const f = readPaymentApp(fixture(file))!;
  return toTransactions({ id: accountId }, prepareImport(accountId, f.drafts, new Set(), []), 'csv', newId);
};

describe('reading payment app files', () => {
  it('reads a Venmo statement: people, notes, signs, funding, balance; skips canceled rows', () => {
    const f = readPaymentApp(fixture('venmo.csv'))!;
    expect(f.app).toBe('venmo');
    expect(f.drafts).toHaveLength(6);
    expect(f.skipped).toBe(1);
    expect(f.balance).toEqual({ amount: 7050, asOf: '2026-09-24' });
    const [pizza, concert, utilities, beer, transfer, dinner] = f.drafts;
    expect(pizza).toMatchObject({ date: '2026-09-06', amount: -2400, p2p: { kind: 'payment', person: 'Alex Smith', note: '🍕 pizza night', fundedFrom: 'CITIZENS BANK *4821' } });
    expect(concert).toMatchObject({ amount: 4500, p2p: { person: 'Jordan Lee' } });
    expect(concert.p2p.fundedFrom).toBeUndefined();
    // A charge you sent: the other person is "To", and the money came in.
    expect(utilities).toMatchObject({ amount: 6250, p2p: { person: 'Casey Park' } });
    expect(beer.p2p.fundedFrom).toBeUndefined();
    expect(transfer).toMatchObject({ amount: -10000, p2p: { kind: 'transfer' } });
    expect(dinner.p2p.person).toBe('Taylor Brooks');
  });

  it('never calls money from a friend income when the note gives no clue', () => {
    const text = fixture('venmo.csv').replace('Concert tix', 'thx');
    const f = readPaymentApp(text)!;
    const rows = toTransactions({ id: 'v' }, prepareImport('v', f.drafts, new Set(), []), 'csv', newId);
    expect(rows.find((r) => r.p2p?.person === 'Jordan Lee')!.categoryId).toBe('uncategorized');
  });

  it('reads a Cash App export', () => {
    const f = readPaymentApp(fixture('cashapp.csv'))!;
    expect(f.app).toBe('cashapp');
    expect(f.skipped).toBe(1);
    expect(f.drafts.map((d) => [d.amount, d.p2p.kind, d.p2p.person])).toEqual([
      [-4000, 'payment', 'Morgan Diaz'],
      [4000, 'payment', 'Jamie Fox'],
      [-875, 'purchase', 'Blue Bottle Coffee'],
      [-2500, 'transfer', 'Visa Debit 4821'],
    ]);
    expect(f.drafts[0].p2p.fundedFrom).toBe('Visa Debit 4821');
    expect(f.drafts[0].date).toBe('2026-09-05');
  });

  it('adds the sign from the type when the export leaves it off', () => {
    const text = 'Transaction ID,Date,Transaction Type,Amount,Net Amount,Status,Notes,Name of sender/receiver,Account\nx,2026-09-05,Sent P2P,$10.00,$10.00,COMPLETE,,Ann Lee,Your Cash\n';
    expect(readPaymentApp(text)!.drafts[0].amount).toBe(-1000);
  });

  it('ignores ordinary bank files', () => {
    expect(readPaymentApp(fixture('discover.csv'))).toBeNull();
    expect(readPaymentApp(fixture('generic-checking.csv'))).toBeNull();
  });
});

describe('people', () => {
  it('cleans up names from banks and apps', () => {
    expect(personName('VENMO *ALEX SMITH')).toBe('Alex Smith');
    expect(personName('Cash App*Alex Smith*San Francisco CA')).toBe('Alex Smith');
    expect(personName('alex smith')).toBe('Alex Smith');
    expect(personName("Mary O'Neil")).toBe("Mary O'Neil");
    expect(personFromBankLine('VENMO *ALEX SMITH')).toBe('Alex Smith');
    expect(personFromBankLine('VENMO PAYMENT 1023456789 WEB ID: 3264681992')).toBeUndefined();
    expect(personFromBankLine('VENMO CASHOUT')).toBeUndefined();
  });

  it('matches first names and full names', () => {
    expect(samePerson('Alex', 'Alex Smith')).toBe(true);
    expect(samePerson('alex smith', 'Alex Smith')).toBe(true);
    expect(samePerson('Alex S', 'Alex Smith')).toBe(true);
    expect(samePerson('Alex Jones', 'Alex Smith')).toBe(false);
    expect(samePerson('Sam', 'Alex')).toBe(false);
  });

  it('adds up what you sent, received and are owed per person', () => {
    const all = [
      tx('venmo', '2026-09-01', -2000, 'Venmo · Alex Smith', { p2p: { app: 'venmo', person: 'Alex Smith', kind: 'payment' } }),
      tx('venmo', '2026-09-03', 500, 'Venmo · Alex', { p2p: { app: 'venmo', person: 'Alex', kind: 'payment' } }),
      tx('chk', '2026-09-04', -3000, 'Dinner', { owedBy: 'Alex', categoryId: 'owed' }),
      tx('chk', '2026-09-05', -1200, 'VENMO *JORDAN LEE'),
    ];
    const list = people(all);
    expect(list.map((p) => [p.name, p.sent, p.received, p.owes])).toEqual([
      ['Jordan Lee', 1200, 0, 0],
      ['Alex Smith', 2000, 500, 3000],
    ]);
  });
});

describe('bank lines', () => {
  it('knows which app a bank line is from and which are transfers', () => {
    expect(bankLineApp('VENMO PAYMENT 1023456789')).toBe('venmo');
    expect(bankLineApp('Cash App*Alex Smith')).toBe('cashapp');
    expect(bankLineApp('SQ *CASH APP')).toBe('cashapp');
    expect(bankLineApp('APPLE CASH SENT MONEY')).toBe('applecash');
    expect(isAppTransferLine('VENMO CASHOUT PPD ID: 5264681992')).toBe(true);
    expect(isAppTransferLine('APPLE CASH INST XFER')).toBe(true);
    expect(isAppTransferLine('Cash App*Cash Out')).toBe(true);
    expect(isAppTransferLine('VENMO PAYMENT 1023456789')).toBe(false);
    expect(isAppTransferLine('APPLE CASH SENT MONEY')).toBe(false);
    expect(isAppTransferLine('Venmo · Alex Smith · money transfer for rent')).toBe(false);
  });

  it('files app transfers under Transfer and never guesses Income for money from a friend', () => {
    expect(categorize({ description: 'VENMO CASHOUT', payee: 'Venmo', amount: 10000 }, []).categoryId).toBe('transfer');
    expect(categorize({ description: 'VENMO PAYMENT 12345', payee: 'Venmo', amount: 2400 }, []).categoryId).toBe('uncategorized');
    expect(categorize({ description: 'ACME PAYROLL', payee: 'Acme', amount: 2400 }, []).categoryId).toBe('income');
  });

  it('categorizes app payments from the note, emoji included', () => {
    const rows = walletRows('venmo.csv');
    const cat = (person: string) => rows.find((r) => r.p2p?.person === person)!.categoryId;
    expect(cat('Alex Smith')).toBe('dining');
    expect(rows.find((r) => r.p2p?.note === '🍻')!.categoryId).toBe('alcohol');
    expect(cat('Casey Park')).toBe('bills');
    expect(rows.find((r) => r.p2p?.kind === 'transfer')!.categoryId).toBe('transfer');
    expect(cat('Jordan Lee')).toBe('entertainment');
    expect(cat('Taylor Brooks')).toBe('dining');
    expect(categoryFromNote('🎁 bday')).toBe('gifts');
    expect(categoryFromNote('🏠')).toBe('housing');
    expect(categoryFromNote('rent')).toBeNull();
  });
});

describe('merging bank-funded payments', () => {
  const accounts = [acct('chk', 'checking'), acct('venmo', 'wallet')];

  it('puts the app details on the bank line when the bank file came first', () => {
    const bank = tx('chk', '2026-09-08', -2400, 'VENMO PAYMENT 1023456789 WEB ID: 3264681992');
    const other = tx('chk', '2026-09-08', -2400, 'SHELL OIL 1234');
    const rows = walletRows('venmo.csv');
    const { add, update } = placeAppTransactions(rows, [bank, other], accounts, newId);
    // The pizza payment isn't added to Venmo (Venmo's balance never changed); the bank line has it.
    expect(add.some((t) => t.p2p?.person === 'Alex Smith' && t.amount === -2400)).toBe(false);
    const u = update.find((x) => x.id === bank.id)!;
    expect(u.changes).toMatchObject({ payee: 'Alex Smith', categoryId: 'dining', notes: '🍕 pizza night', p2p: { app: 'venmo', person: 'Alex Smith' } });
    expect(u.changes.p2p!.appImportId).toMatch(/venmo:4101/);
    expect(update.some((x) => x.id === other.id)).toBe(false);
  });

  it('keeps your own category on the bank line', () => {
    const bank = tx('chk', '2026-09-07', -2400, 'VENMO PAYMENT 1023', { categoryId: 'gifts', categorySource: 'user' });
    const { update } = placeAppTransactions(walletRows('venmo.csv'), [bank], accounts, newId);
    expect(update[0].changes.categoryId).toBeUndefined();
    expect(update[0].changes.payee).toBe('Alex Smith');
  });

  it('waits as a pair when the bank file comes later, then merges without counting twice', () => {
    const rows = walletRows('venmo.csv');
    const { add } = placeAppTransactions(rows, [], accounts, newId);
    const pair = add.filter((t) => t.p2p?.ref);
    expect(pair.map((t) => [t.amount, t.categoryId, t.p2p!.role])).toEqual([
      [-2400, 'dining', 'payment'],
      [2400, 'transfer', 'funding'],
    ]);
    // The app balance: the pair cancels out, like it does in Venmo.
    expect(add.reduce((s, t) => s + t.amount, 0)).toBe(-2400 + 2400 + 4500 + 6250 - 1800 - 10000 + 3100);

    const bank = tx('chk', '2026-09-08', -2400, 'VENMO PAYMENT 1023456789');
    const cashout = tx('chk', '2026-09-19', 10000, 'VENMO PAYMENT 99', { categoryId: 'income', categorySource: 'default' });
    const { update, remove } = linkWaitingPayments([...add, bank, cashout], accounts);
    expect(remove.sort()).toEqual(pair.map((t) => t.id).sort());
    expect(update.find((u) => u.id === bank.id)!.changes).toMatchObject({ payee: 'Alex Smith', categoryId: 'dining' });
    // Venmo's transfer to the bank: the bank's side is a transfer too.
    expect(update.find((u) => u.id === cashout.id)!.changes.categoryId).toBe('transfer');
  });

  it('does not match a different amount, a far-off date or a line from another app', () => {
    const rows = walletRows('venmo.csv');
    const lines = [
      tx('chk', '2026-09-08', -2500, 'VENMO PAYMENT'),
      tx('chk', '2026-09-20', -2400, 'VENMO PAYMENT'),
      tx('chk', '2026-09-07', -2400, 'Cash App*Alex Smith'),
    ];
    const { update } = placeAppTransactions(rows, lines, accounts, newId);
    expect(update.filter((u) => u.changes.payee)).toEqual([]);
  });
});

describe('paybacks', () => {
  it('matches money from a friend to what they owe you', () => {
    const dinner = tx('chk', '2026-09-02', -6000, 'Olive Garden', { owedBy: 'Alex', categoryId: 'owed' });
    const tickets = tx('chk', '2026-09-03', -8000, 'Ticketmaster', {
      splits: [
        { id: 's1', amount: -4000, categoryId: 'entertainment' },
        { id: 's2', amount: -4000, categoryId: 'entertainment', owedBy: 'Jordan' },
      ],
    });
    const fromAlex = tx('venmo', '2026-09-05', 6000, 'Venmo · Alex Smith', { p2p: { app: 'venmo', person: 'Alex Smith', kind: 'payment' } });
    const fromJordan = tx('venmo', '2026-09-06', 4000, 'Venmo · Jordan Lee', { p2p: { app: 'venmo', person: 'Jordan Lee', kind: 'payment' } });
    const fromStranger = tx('venmo', '2026-09-06', 6000, 'Venmo · Pat Kim', { p2p: { app: 'venmo', person: 'Pat Kim', kind: 'payment' } });
    const wrongAmount = tx('venmo', '2026-09-06', 1000, 'Venmo · Alex', { p2p: { app: 'venmo', person: 'Alex', kind: 'payment' } });
    const m = paybackMatches([dinner, tickets, fromAlex, fromJordan, fromStranger, wrongAmount]);
    expect(m.map((x) => [x.txn.id, x.who, x.items.length])).toEqual([
      [fromAlex.id, 'Alex', 1],
      [fromJordan.id, 'Jordan', 1],
    ]);
    expect(m[1].items[0].splitId).toBe('s2');
  });

  it('matches one payment for everything someone owes, and skips what is already settled', () => {
    const a = tx('chk', '2026-09-02', -1500, 'Lunch', { owedBy: 'Casey Park', categoryId: 'owed' });
    const b = tx('chk', '2026-09-04', -2500, 'Movies', { owedBy: 'Casey Park', categoryId: 'owed' });
    const paid = tx('chk', '2026-09-01', -900, 'Coffee', { owedBy: 'Casey Park', categoryId: 'owed', settledBy: 'untracked' });
    const back = tx('chk', '2026-09-10', 4000, 'VENMO *CASEY PARK');
    const m = paybackMatches([a, b, paid, back]);
    expect(m).toHaveLength(1);
    expect(m[0].items.map((i) => i.txn.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('lists app payments that still need a category', () => {
    const list = unexplainedAppPayments([
      tx('venmo', '2026-09-05', 4500, 'Venmo · Jordan Lee', { p2p: { app: 'venmo', person: 'Jordan Lee', kind: 'payment' } }),
      tx('chk', '2026-09-06', -3000, 'APPLE CASH SENT MONEY'),
      tx('chk', '2026-09-06', 10000, 'VENMO CASHOUT', { categoryId: 'transfer', categorySource: 'keyword' }),
      tx('chk', '2026-09-06', -3000, 'VENMO *AL', { categoryId: 'dining', categorySource: 'user' }),
      tx('chk', '2026-09-06', -3000, 'SHAWS'),
    ]);
    expect(list.map((t) => t.description)).toEqual(['APPLE CASH SENT MONEY', 'Venmo · Jordan Lee']);
  });
});

describe('asking about people', async () => {
  const { answer, parseQuestion } = await import('../src/ai/ask');
  const { DEFAULT_CATEGORIES } = await import('../src/lib/categories');
  const ctx = { today: '2026-09-29', categories: DEFAULT_CATEGORIES, merchants: ['Alex Smith', 'Starbucks'], people: ['Alex Smith', 'Jordan Lee', 'Will Park'] };
  const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
  const txns = [
    tx('venmo', '2026-03-01', -2000, 'Venmo · Alex Smith', { p2p: { app: 'venmo', person: 'Alex Smith', kind: 'payment', note: 'rent' } }),
    tx('venmo', '2026-09-03', 500, 'Venmo · Alex Smith', { p2p: { app: 'venmo', person: 'Alex Smith', kind: 'payment' } }),
    tx('chk', '2026-09-04', -3000, 'Dinner', { owedBy: 'Jordan', categoryId: 'owed' }),
  ];
  const data = { txns, categories: cats, recurring: [], budgets: [], netWorth: { net: 0, change: 0, since: '' } };

  it('understands "how much have I sent Alex" (all time unless you say when)', () => {
    const q = parseQuestion('How much have I sent Alex?', ctx)!;
    expect(q).toMatchObject({ intent: 'person', person: 'Alex Smith', merchant: undefined });
    expect(answer(q, data).headline).toBe('You sent Alex Smith $20.00 and received $5.00 overall.');
    expect(parseQuestion('how much did I venmo alex this month', ctx)).toMatchObject({ intent: 'person', period: { from: '2026-09-01' } });
  });

  it('understands "who owes me"', () => {
    const q = parseQuestion('Who owes me money?', ctx)!;
    expect(q.intent).toBe('owed');
    expect(answer(q, data).headline).toBe('Jordan owes you $30.00.');
    expect(answer(parseQuestion('does Alex owe me anything', ctx)!, data).headline).toBe("Alex Smith doesn't owe you anything.");
  });

  it('leaves ordinary questions alone', () => {
    expect(parseQuestion('how much will I spend on dining this month', ctx)!.intent).toBe('spending');
    expect(parseQuestion('how much did I spend at Starbucks', ctx)).toMatchObject({ intent: 'spending', merchant: 'Starbucks' });
  });
});
