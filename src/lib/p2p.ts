/**
 * Payment apps: Venmo, Cash App and Apple Cash.
 *
 * Each app is its own "Payment app" account with its own balance. The tricky part is payments paid
 * straight from your bank or debit card: the bank's file has the money leaving ("VENMO PAYMENT"), and
 * the app's statement has who it went to and why. Those become one transaction: the bank's line
 * (right account, right balance) with the person, note and category from the app.
 */
import Papa from 'papaparse';
import type { Account, Cents, CategorySource, ISODate, PaymentApp, Transaction } from '../types';
import type { DraftTransaction } from './draft';
import { OWED, TRANSFER, UNCATEGORIZED } from './categories';
import { addDays, parseBankDate } from './dates';
import { parseAmount } from './money';
import { owedItems, type OwedItem } from './lines';

export const APP_NAMES: Record<PaymentApp, string> = { venmo: 'Venmo', cashapp: 'Cash App', applecash: 'Apple Cash' };

/** What a payment-app row adds to a draft transaction. */
export interface DraftP2P {
  app: PaymentApp;
  /** The friend (or shop) on the other side. */
  person?: string;
  note?: string;
  /** payment: with a person; transfer: between the app and your bank; purchase: at a shop; reward; other. */
  kind: 'payment' | 'transfer' | 'purchase' | 'reward' | 'other';
  /** Paid straight from a bank or card (not the app balance): its name, e.g. "Chase *1234". */
  fundedFrom?: string;
}

export type AppDraft = DraftTransaction & { p2p: DraftP2P };

export interface AppFile {
  app: PaymentApp;
  drafts: AppDraft[];
  /** The statement's ending balance, when the file has one (Venmo does). */
  balance?: { amount: Cents; asOf: ISODate };
  /** Rows left out: canceled, failed or declined payments, and blank lines. */
  skipped: number;
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Venmo's date is "2026-09-03T19:22:11"; Cash App's is "2026-09-03 19:22:11 EDT". */
function appDate(raw: string | undefined): ISODate | null {
  const s = (raw ?? '').trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : parseBankDate(s);
}

const FAILED = /cancel|fail|declin|revers|refused|expired/i;

/** A Venmo statement or a Cash App activity export, or null for any other file. */
export function readPaymentApp(text: string): AppFile | null {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false }).data.map((r) => r.map((c) => (c ?? '').toString()));
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = rows[i].map(norm);
    if (h.includes('funding source') && h.includes('destination') && h.some((c) => c.startsWith('amount (total)'))) return readVenmo(rows, i);
    if (h.includes('transaction type') && (h.includes('name of sender/receiver') || (h.includes('net amount') && h.includes('transaction id'))))
      return readCashApp(rows, i);
  }
  return null;
}

function columns(header: string[]) {
  const h = header.map(norm);
  return (...names: string[]) => {
    for (const n of names) {
      const i = h.findIndex((c) => c === n || c.startsWith(`${n} (`));
      if (i !== -1) return i;
    }
    return -1;
  };
}

const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
const isBalance = (s: string) => !s || /venmo balance|cash balance|^(your )?cash$|^balance$/i.test(s.trim());

function readVenmo(rows: string[][], headerIndex: number): AppFile {
  const col = columns(rows[headerIndex]);
  const c = {
    id: col('id'),
    date: col('datetime', 'date'),
    type: col('type'),
    status: col('status'),
    note: col('note'),
    from: col('from'),
    to: col('to'),
    amount: col('amount (total)'),
    funding: col('funding source'),
    destination: col('destination'),
    ending: col('ending balance'),
  };
  const drafts: AppDraft[] = [];
  let skipped = 0;
  let ending: Cents | null = null;
  for (const r of rows.slice(headerIndex + 1)) {
    if (!r.some((x) => x.trim())) continue;
    const end = parseAmount(cell(r, c.ending));
    if (end != null) ending = end;
    const date = appDate(cell(r, c.date));
    const amount = parseAmount(cell(r, c.amount));
    // The first and last rows only carry the beginning and ending balances.
    if (!date || amount == null || !cell(r, c.id)) {
      if (cell(r, c.id) || cell(r, c.type)) skipped++;
      continue;
    }
    if (FAILED.test(cell(r, c.status)) || amount === 0) {
      skipped++;
      continue;
    }
    const type = cell(r, c.type).toLowerCase();
    const from = personName(cell(r, c.from));
    const to = personName(cell(r, c.to));
    const note = cell(r, c.note) || undefined;
    const funding = cell(r, c.funding);
    const destination = cell(r, c.destination);
    let p2p: DraftP2P;
    if (/transfer|add funds|cash ?out|withdraw/.test(type)) {
      p2p = { app: 'venmo', kind: 'transfer', person: amount < 0 ? destination || undefined : funding || undefined };
    } else if (type === 'payment' || type === 'charge') {
      // A payment's "From" pays "To"; a charge's "From" is the one asking to be paid.
      const person = type === 'payment' ? (amount > 0 ? from : to) : amount > 0 ? to : from;
      p2p = { app: 'venmo', kind: 'payment', person: person || undefined, note };
    } else if (/reward|cash ?back|interest/.test(type)) {
      p2p = { app: 'venmo', kind: 'reward', note };
    } else if (/merchant|purchase|debit card|card transaction|refund/.test(type)) {
      p2p = { app: 'venmo', kind: 'purchase', person: (amount < 0 ? to : from) || undefined, note };
    } else {
      p2p = { app: 'venmo', kind: 'other', person: (amount < 0 ? to : from) || undefined, note };
    }
    if (amount < 0 && p2p.kind !== 'transfer' && !isBalance(funding)) p2p.fundedFrom = funding;
    drafts.push({ date, amount, description: describe(p2p, type), fitid: `venmo:${cell(r, c.id)}`, p2p });
  }
  const last = drafts.reduce<ISODate | undefined>((m, d) => (!m || d.date > m ? d.date : m), undefined);
  return { app: 'venmo', drafts, skipped, balance: ending != null && last ? { amount: ending, asOf: last } : undefined };
}

function readCashApp(rows: string[][], headerIndex: number): AppFile {
  const col = columns(rows[headerIndex]);
  const c = {
    id: col('transaction id'),
    date: col('date'),
    type: col('transaction type'),
    amount: col('amount'),
    net: col('net amount'),
    status: col('status'),
    note: col('notes', 'note', 'memo'),
    name: col('name of sender/receiver', 'name', 'counterparty'),
    account: col('account'),
  };
  const drafts: AppDraft[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  for (const r of rows.slice(headerIndex + 1)) {
    if (!r.some((x) => x.trim())) continue;
    const date = appDate(cell(r, c.date));
    let amount = parseAmount(cell(r, c.net)) ?? parseAmount(cell(r, c.amount));
    if (!date || amount == null || amount === 0 || FAILED.test(cell(r, c.status))) {
      skipped++;
      continue;
    }
    const type = cell(r, c.type).toLowerCase();
    const raw = cell(r, c.amount) || cell(r, c.net);
    // When the export leaves the sign off, the kind of transaction says which way the money went.
    if (!/^[-(]|-$/.test(raw.replace(/\s/g, ''))) {
      if (/sent|cash out|card|withdraw|buy|purchase|payment$|fee/.test(type)) amount = -Math.abs(amount);
    }
    const name = personName(cell(r, c.name));
    const note = cell(r, c.note) || undefined;
    const account = cell(r, c.account);
    let p2p: DraftP2P;
    if (
      /cash ?out|withdraw|transfer to bank|add cash|cash in|deposit(?!.*direct)|transfer from bank/.test(type) &&
      !/direct|paycheck|payroll/.test(type)
    ) {
      p2p = { app: 'cashapp', kind: 'transfer', person: account || undefined };
    } else if (/p2p|sent|received|request|payment/.test(type) && name) {
      p2p = { app: 'cashapp', kind: 'payment', person: name, note };
    } else if (/card|purchase|boost/.test(type)) {
      p2p = { app: 'cashapp', kind: 'purchase', person: name || note, note: name ? note : undefined };
    } else if (/reward|cash ?back|interest/.test(type)) {
      p2p = { app: 'cashapp', kind: 'reward', note };
    } else {
      p2p = { app: 'cashapp', kind: 'other', person: name || undefined, note };
    }
    if (amount < 0 && p2p.kind === 'payment' && !isBalance(account)) p2p.fundedFrom = account;
    let id = cell(r, c.id);
    if (!id) {
      // No id column: fall back to the row's contents (numbered, so two identical payments both count).
      const key = `${date}|${amount}|${name}|${note ?? ''}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      id = `${key}#${n}`;
    }
    drafts.push({ date, amount, description: describe(p2p, type), fitid: `cashapp:${id}`, p2p });
  }
  return { app: 'cashapp', drafts, skipped };
}

/** "Venmo · Alex Smith · 🍕 pizza": what's shown as the bank description and what keywords read. */
function describe(p: DraftP2P, type: string): string {
  const app = APP_NAMES[p.app];
  if (p.kind === 'transfer') return `${app} ${type || 'transfer'}${p.person ? ` · ${p.person}` : ''}`;
  return [app, p.person, p.note].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

const APP_PREFIX = /^(venmo|cash ?app|square cash|sq ?\*? ?cash|apple cash)\b[\s*:·-]*/i;

/** "VENMO *ALEX SMITH", "Cash App*Alex Smith*San Francisco", "alex smith" → "Alex Smith". */
export function personName(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return '';
  s = s.replace(APP_PREFIX, '');
  s = s.replace(/^(payment|sent money|sent|to|from|paid)\s+(to|from)?\s*/i, '');
  s = s.split(/\s*\*\s*|\s{2,}/)[0];
  s = s.replace(/^@/, '').replace(/[\s.,-]+$/, '');
  if (s === s.toUpperCase() || s === s.toLowerCase())
    s = s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  return s;
}

/** The same person? Full names must agree; a first name alone ("Alex") matches "Alex Smith". */
export function samePerson(a: string | undefined, b: string | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const y = (b ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (x.length === 1 || y.length === 1) return x[0] === y[0];
  // "Alex S" and "Alex Smith"
  return x[0] === y[0] && (x.at(-1)!.startsWith(y.at(-1)!) || y.at(-1)!.startsWith(x.at(-1)!));
}

// ---------------------------------------------------------------------------------------------
// Bank lines from payment apps
// ---------------------------------------------------------------------------------------------

/** Which app a bank line is from ("VENMO PAYMENT 1023", "Cash App*Alex", "APPLE CASH SENT MONEY"). */
export function bankLineApp(description: string): PaymentApp | null {
  const d = description.toLowerCase();
  if (/venmo/.test(d)) return 'venmo';
  if (/cash ?app|square cash|sq ?\* ?cash/.test(d)) return 'cashapp';
  if (/apple cash/.test(d)) return 'applecash';
  return null;
}

/** Bank lines that are money moving between your bank and an app (not a payment to someone). */
export function isAppTransferLine(description: string): boolean {
  const d = description.toLowerCase();
  return /(venmo|cash ?app|square cash|apple cash)\W{0,3}(\w+\W{1,3})?(cash ?out|add ?funds|addfund|add cash|add money|standard transfer|instant transfer|transfer|inst ?xfer|xfer|balance add|withdraw)/.test(
    d,
  );
}

/** A name the bank itself put on the line: "VENMO *ALEX SMITH" or "Cash App*Alex Smith*…". */
export function personFromBankLine(description: string): string | undefined {
  if (isAppTransferLine(description)) return undefined;
  const m = description.match(/(?:venmo|cash ?app)\s*\*\s*([^*]+)/i);
  const name = m ? personName(m[1]) : '';
  return name && !/^(payment|visa|direct|web|ppd|\d)/i.test(name) ? name : undefined;
}

const SEARCH_DAYS = 5;

/**
 * The bank's line for an app payment paid from the bank: same amount, from the same app, within a few
 * days (the bank usually posts a day or two later), and not already matched.
 */
export function findBankLine(
  pay: { date: ISODate; amount: Cents; app: PaymentApp },
  candidates: Transaction[],
  wallets: Set<string>,
  used = new Set<string>(),
): Transaction | undefined {
  const from = addDays(pay.date, -2);
  const to = addDays(pay.date, SEARCH_DAYS);
  return candidates
    .filter(
      (t) =>
        !wallets.has(t.accountId) &&
        !used.has(t.id) &&
        !t.p2p?.appImportId &&
        t.amount === pay.amount &&
        t.date >= from &&
        t.date <= to &&
        bankLineApp(t.description) === pay.app &&
        !isAppTransferLine(t.description),
    )
    .sort((a, b) => Math.abs(daysApart(a.date, pay.date)) - Math.abs(daysApart(b.date, pay.date)))[0];
}

const daysApart = (a: ISODate, b: ISODate) => (Date.parse(a) - Date.parse(b)) / 86400000;

export interface Update {
  id: string;
  changes: Partial<Transaction>;
}

/** The app's details laid onto the bank's line. Your own category choice on the bank line is kept. */
function enrich(
  bank: Transaction,
  app: Pick<Transaction, 'payee' | 'categoryId' | 'categorySource' | 'notes' | 'tags' | 'splits' | 'owedBy' | 'settledBy'> & {
    importId?: string;
    p2p?: Transaction['p2p'];
  },
): Partial<Transaction> {
  const keepCategory = bank.categorySource === 'user' || bank.categorySource === 'rule' || !!bank.splits?.length || !!bank.owedBy;
  const changes: Partial<Transaction> = {
    payee: app.payee || bank.payee,
    p2p: { ...app.p2p!, appImportId: app.importId, role: undefined, ref: undefined },
  };
  if (!bank.notes && app.notes) changes.notes = app.notes;
  if (!keepCategory) {
    changes.categoryId = app.categoryId;
    changes.categorySource = app.categorySource;
    if (app.splits?.length) changes.splits = app.splits;
    if (app.owedBy) changes.owedBy = app.owedBy;
    if (app.settledBy) changes.settledBy = app.settledBy;
  }
  if (app.tags?.length) changes.tags = [...new Set([...(bank.tags ?? []), ...app.tags])];
  return changes;
}

/**
 * Where each newly read app transaction goes. A payment paid from your bank lands on the bank's line
 * when it's already imported; otherwise it waits in the app account as a pair (the payment and the
 * money coming in from the bank), which merges into the bank's line once that file is imported.
 */
export function placeAppTransactions(
  fresh: Transaction[],
  all: Transaction[],
  accounts: Account[],
  newId: () => string,
): { add: Transaction[]; update: Update[] } {
  const wallets = new Set(accounts.filter((a) => a.type === 'wallet').map((a) => a.id));
  const add: Transaction[] = [];
  const update: Update[] = [];
  const used = new Set<string>();
  for (const t of fresh) {
    const funded = t.p2p?.fundedFrom;
    if (!funded || t.amount >= 0) {
      add.push(t);
      continue;
    }
    const bank = findBankLine({ date: t.date, amount: t.amount, app: t.p2p!.app }, all, wallets, used);
    if (bank) {
      used.add(bank.id);
      update.push({ id: bank.id, changes: enrich(bank, t) });
      continue;
    }
    const ref = t.importId ?? t.id;
    add.push({ ...t, p2p: { ...t.p2p!, role: 'payment', ref } });
    add.push({
      ...t,
      id: newId(),
      amount: -t.amount,
      payee: `From ${funded}`,
      description: `${APP_NAMES[t.p2p!.app]} · paid from ${funded}`,
      categoryId: TRANSFER,
      categorySource: 'rule',
      notes: '',
      tags: undefined,
      importId: `${ref}:funding`,
      p2p: { app: t.p2p!.app, role: 'funding', ref },
    });
  }
  // Moves between your bank and the app: the bank's side is a transfer too.
  for (const t of add.filter((x) => x.p2p?.kind === 'transfer' && !x.p2p.role)) {
    const bank = all.find(
      (b) =>
        !wallets.has(b.accountId) &&
        !used.has(b.id) &&
        b.amount === -t.amount &&
        Math.abs(daysApart(b.date, t.date)) <= SEARCH_DAYS &&
        bankLineApp(b.description) === t.p2p!.app &&
        b.categoryId !== TRANSFER &&
        b.categorySource !== 'user',
    );
    if (bank) {
      used.add(bank.id);
      update.push({ id: bank.id, changes: { categoryId: TRANSFER, categorySource: 'rule' } });
    }
  }
  return { add, update };
}

/**
 * After a bank import: merge app payments that were waiting for their bank line. Returns the bank
 * lines to update and the waiting pairs to remove.
 */
export function linkWaitingPayments(all: Transaction[], accounts: Account[]): { update: Update[]; remove: string[] } {
  const wallets = new Set(accounts.filter((a) => a.type === 'wallet').map((a) => a.id));
  const update: Update[] = [];
  const remove: string[] = [];
  const used = new Set<string>();
  const byRef = new Map<string, Transaction[]>();
  for (const t of all) if (t.p2p?.ref) byRef.set(t.p2p.ref, [...(byRef.get(t.p2p.ref) ?? []), t]);
  for (const pair of byRef.values()) {
    const pay = pair.find((t) => t.p2p?.role === 'payment');
    const funding = pair.find((t) => t.p2p?.role === 'funding');
    if (!pay || !funding) continue;
    const bank = findBankLine({ date: pay.date, amount: pay.amount, app: pay.p2p!.app }, all, wallets, used);
    if (!bank) continue;
    used.add(bank.id);
    update.push({ id: bank.id, changes: enrich(bank, pay) });
    remove.push(pay.id, funding.id);
  }
  // Transfers the app file already showed: file the bank's side under Transfer.
  for (const t of all.filter((x) => wallets.has(x.accountId) && x.p2p?.kind === 'transfer')) {
    const bank = all.find(
      (b) =>
        !wallets.has(b.accountId) &&
        !used.has(b.id) &&
        b.amount === -t.amount &&
        Math.abs(daysApart(b.date, t.date)) <= SEARCH_DAYS &&
        bankLineApp(b.description) === t.p2p!.app &&
        b.categoryId !== TRANSFER &&
        b.categorySource !== 'user',
    );
    if (bank) {
      used.add(bank.id);
      update.push({ id: bank.id, changes: { categoryId: TRANSFER, categorySource: 'rule' } });
    }
  }
  return { update, remove };
}

/** Import ids already covered, so re-importing a statement doesn't add merged payments again. */
export function appImportIds(all: Transaction[]): Set<string> {
  const ids = new Set<string>();
  for (const t of all) if (t.p2p?.appImportId) ids.add(t.p2p.appImportId);
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Paybacks, "what was this?" and people
// ---------------------------------------------------------------------------------------------

/** Who a transaction was with: the app's person, or a name the bank put on the line. */
export function personOf(t: Transaction): string | undefined {
  if (t.p2p?.role === 'funding' || t.p2p?.kind === 'transfer' || t.p2p?.kind === 'purchase') return undefined;
  return t.p2p?.person || (bankLineApp(t.description) ? personFromBankLine(t.description) : undefined);
}

export interface Payback {
  txn: Transaction;
  who: string;
  items: OwedItem[];
}

/**
 * Money from a friend that pays back what they owe you: same person, and the amount of one thing they
 * owe or of everything they owe.
 */
export function paybackMatches(all: Transaction[]): Payback[] {
  const open = owedItems(all).filter((i) => !i.settledBy);
  if (!open.length) return [];
  const usedAsRepayment = new Set(owedItems(all).map((i) => i.settledBy));
  const out: Payback[] = [];
  const claimed = new Set<OwedItem>();
  const incoming = all
    .filter((t) => t.amount > 0 && !usedAsRepayment.has(t.id) && t.categoryId !== OWED && !t.splits?.length && personOf(t))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const t of incoming) {
    const who = personOf(t)!;
    const theirs = open.filter((i) => !claimed.has(i) && samePerson(i.who, who) && i.date <= addDays(t.date, 3));
    if (!theirs.length) continue;
    const one = theirs.find((i) => i.amount === t.amount);
    const total = theirs.reduce((s, i) => s + i.amount, 0);
    const items = one ? [one] : total === t.amount ? theirs : null;
    if (!items) continue;
    items.forEach((i) => claimed.add(i));
    out.push({ txn: t, who: items[0].who, items });
  }
  return out;
}

/** App payments that still need a category: a friend paid or paid you, and the app can't tell why. */
export function unexplainedAppPayments(all: Transaction[], dismissed: Set<string> = new Set()): Transaction[] {
  return all
    .filter((t) => {
      if (dismissed.has(t.id) || t.p2p?.role === 'funding' || t.splits?.length) return false;
      const fromApp = !!t.p2p || !!bankLineApp(t.description);
      if (!fromApp || t.p2p?.kind === 'transfer' || isAppTransferLine(t.description)) return false;
      const weak = t.categoryId === UNCATEGORIZED || t.categorySource === 'default' || (t.categorySource === 'bank' && t.categoryId === 'other');
      return weak && t.categoryId !== TRANSFER;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface Person {
  name: string;
  sent: Cents;
  received: Cents;
  /** Still unpaid, from "Owed to Me". */
  owes: Cents;
  txns: Transaction[];
  last: ISODate;
}

/** Everyone you've paid or been paid by through an app, plus anyone who owes you. */
export function people(all: Transaction[], period?: { from: ISODate; to: ISODate }): Person[] {
  const list: Person[] = [];
  const find = (name: string) => {
    let p = list.find((x) => samePerson(x.name, name));
    if (!p) list.push((p = { name, sent: 0, received: 0, owes: 0, txns: [], last: '' }));
    // Prefer the fuller spelling ("Alex Smith" over "Alex").
    else if (name.length > p.name.length && name.toLowerCase().startsWith(p.name.toLowerCase().split(' ')[0])) p.name = name;
    return p;
  };
  for (const t of all) {
    const who = personOf(t);
    if (!who || (period && (t.date < period.from || t.date > period.to))) continue;
    const p = find(who);
    if (t.amount < 0) p.sent -= t.amount;
    else p.received += t.amount;
    p.txns.push(t);
    if (t.date > p.last) p.last = t.date;
  }
  for (const i of owedItems(all)) {
    if (i.settledBy) continue;
    const p = find(i.who);
    p.owes += i.amount;
    if (i.date > p.last) p.last = i.date;
  }
  for (const p of list) p.txns.sort((a, b) => (a.date < b.date ? 1 : -1));
  return list.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

/** Emoji people put in payment notes, and the category each suggests. */
const NOTE_EMOJI: [RegExp, string][] = [
  [/[🍕🍔🌮🌯🍣🍜🍝🥡🍱🍟🌭🥗🍗🍛🥘🍽🍴]/u, 'dining'],
  [/[🍺🍻🍷🥂🍸🍹🥃🍾]/u, 'alcohol'],
  [/[☕]/u, 'coffee'],
  [/[🛒🥑🥦🍎🥕]/u, 'groceries'],
  [/[🏠🏡🔑]/u, 'housing'],
  [/[💡⚡🔌💧📶📺]/u, 'bills'],
  [/[⛽]/u, 'gas'],
  [/[🚕🚖🚗🚙🚌🚇🚆]/u, 'transport'],
  [/[✈🛫🏨🏖🧳🏝]/u, 'travel'],
  [/[🎁🎂🎉🎈💐]/u, 'gifts'],
  [/[🎟🎫🎬🎤🎮🎳🎶🎵⚽🏀🏈⛳]/u, 'entertainment'],
  [/[🐶🐱🐕🐈🐾]/u, 'pets'],
  [/[💊🏥🩺]/u, 'health'],
  [/[👕👗👟👖]/u, 'clothing'],
  [/[🏋💪🧘]/u, 'fitness'],
];

export function categoryFromNote(note: string | undefined): string | null {
  if (!note) return null;
  for (const [re, id] of NOTE_EMOJI) if (re.test(note)) return id;
  return null;
}

/** Category for an app transaction that rules and keywords didn't decide. */
export function appFallback(p: DraftP2P, amount: Cents): { categoryId: string; source: CategorySource } | null {
  if (p.kind === 'transfer') return { categoryId: TRANSFER, source: 'rule' };
  if (p.kind === 'reward') return { categoryId: 'income', source: 'keyword' };
  const fromNote = categoryFromNote(p.note);
  if (fromNote && (amount < 0 || p.kind === 'payment')) return { categoryId: fromNote, source: 'keyword' };
  return null;
}
