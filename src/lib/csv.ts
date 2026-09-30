import Papa from 'papaparse';
import type { AccountType, CsvMapping } from '../types';
import type { DraftTransaction, SourceAccount } from './draft';
import { parseBankDate } from './dates';
import { parseAmount } from './money';

export interface CsvTable {
  rows: string[][];
  headerIndex: number;
  headers: string[];
}

export interface CsvDetection {
  /** Human-readable name of the recognised export format. */
  format: string;
  mapping: CsvMapping;
  /** Tips to show in the import screen for this format. */
  note?: string;
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

const DATE = ['transaction date', 'trans. date', 'trans date', 'date', 'run date', 'posting date', 'posted date', 'post date', 'effective date', 'settlement date'];
const DESC = ['description', 'transaction description', 'payee', 'merchant', 'merchant name', 'name', 'memo', 'details', 'action'];
const AMOUNT = ['amount', 'amount ($)', 'transaction amount', 'amount (usd)', 'net amount'];
const DEBIT = ['debit', 'debits', 'debit amount', 'withdrawal', 'withdrawals', 'withdrawal amount', 'withdrawals ($)', 'money out', 'charges'];
const CREDIT = ['credit', 'credits', 'credit amount', 'deposit', 'deposits', 'deposit amount', 'deposits ($)', 'money in', 'payments'];
const CATEGORY = ['category', 'transaction category'];
const TYPE = ['transaction type', 'type', 'credit/debit', 'debit/credit', 'dr/cr'];

export function readCsv(text: string): CsvTable {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false });
  const rows = parsed.data.map((r) => r.map((c) => (c ?? '').toString()));
  const headerIndex = findHeaderRow(rows);
  return { rows, headerIndex, headers: headerIndex >= 0 ? rows[headerIndex] : [] };
}

/** Some exports (e.g. Fidelity) put blank lines or a title above the real header row. */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map(norm);
    const hasDate = cells.some((c) => DATE.includes(c));
    const hasMoney = cells.some((c) => AMOUNT.includes(c) || DEBIT.includes(c) || CREDIT.includes(c));
    if (hasDate && hasMoney) return i;
  }
  // Fall back to the first row that has several non-empty cells.
  return rows.findIndex((r) => r.filter((c) => c.trim()).length >= 3);
}

export function headerSignature(headers: string[]): string {
  return headers.map(norm).join('|');
}

function col(headers: string[], names: string[]): number | null {
  const cells = headers.map(norm);
  for (const name of names) {
    const i = cells.indexOf(name);
    if (i !== -1) return i;
  }
  return null;
}

function dataRows(table: CsvTable): string[][] {
  return table.rows.slice(table.headerIndex + 1).filter((r) => r.some((c) => c.trim()));
}

const TYPE_VALUE = /^(debit|credit|dr|cr|withdrawal|deposit)$/i;

export function detectFormat(table: CsvTable, accountType?: AccountType): CsvDetection {
  const h = table.headers.map(norm);
  const has = (name: string) => h.includes(name);
  const signature = headerSignature(table.headers);
  const base: CsvMapping = {
    signature,
    date: col(table.headers, DATE) ?? 0,
    description: col(table.headers, DESC) ?? 1,
    amount: col(table.headers, AMOUNT),
    debit: col(table.headers, DEBIT),
    credit: col(table.headers, CREDIT),
    category: col(table.headers, CATEGORY),
    type: null,
    invert: false,
  };

  if (has('account name') && has('amount') && (has('custom name') || has('original date') || has('institution name'))) {
    // Rocket Money: every linked account in one file, its own store names and categories.
    const mapping: CsvMapping = {
      ...base,
      date: col(table.headers, ['date'])!,
      description: col(table.headers, ['description', 'name'])!,
      amount: col(table.headers, ['amount']),
      debit: null,
      credit: null,
      category: col(table.headers, ['category']),
      invert: false,
      payee: [col(table.headers, ['custom name']), col(table.headers, ['name'])].filter((x): x is number => x != null),
      sourceAccount: {
        institution: col(table.headers, ['institution name', 'institution']),
        name: col(table.headers, ['account name']),
        number: col(table.headers, ['account number', 'account mask']),
        type: col(table.headers, ['account type']),
      },
    };
    mapping.invert = rocketMoneyInverted(dataRows(table), mapping);
    return {
      format: 'Rocket Money',
      mapping,
      note: 'Rocket Money lists every account in one file: pick which one to import. Its store names and categories are used.',
    };
  }
  if (has('trans. date') && has('post date') && has('amount')) {
    return {
      format: 'Discover',
      mapping: { ...base, amount: col(table.headers, ['amount']), debit: null, credit: null, invert: true },
      note: 'Discover lists purchases as positive amounts, so signs are flipped automatically.',
    };
  }
  if (has('card no.') && has('debit') && has('credit')) {
    return {
      format: 'Capital One (card)',
      mapping: { ...base, date: col(table.headers, ['transaction date']) ?? base.date, amount: null },
    };
  }
  if (has('transaction type') && has('transaction amount') && has('balance')) {
    return {
      format: 'Capital One 360',
      mapping: { ...base, date: col(table.headers, ['transaction date']) ?? base.date, amount: col(table.headers, ['transaction amount']), debit: null, credit: null, type: col(table.headers, ['transaction type']) },
    };
  }
  if (has('run date') && has('action')) {
    return {
      format: 'Fidelity',
      mapping: { ...base, date: col(table.headers, ['run date'])!, description: col(table.headers, ['action'])!, amount: col(table.headers, ['amount ($)', 'amount']), debit: null, credit: null, category: null },
      note: 'Buys, sells and reinvestments are filed under Investments so they don’t count as spending.',
    };
  }

  // Generic file: prefer a single signed amount column; otherwise use debit/credit columns.
  const mapping = { ...base };
  if (mapping.amount != null) {
    mapping.debit = null;
    mapping.credit = null;
    const typeCol = col(table.headers, TYPE);
    const rows = dataRows(table).slice(0, 50);
    if (typeCol != null && rows.some((r) => TYPE_VALUE.test((r[typeCol] ?? '').trim()))) {
      mapping.type = typeCol;
    } else if (accountType === 'credit') {
      // Most card exports list purchases as positive numbers.
      const amounts = rows.map((r) => parseAmount(r[mapping.amount!])).filter((a): a is number => a != null);
      const positives = amounts.filter((a) => a > 0).length;
      mapping.invert = amounts.length > 0 && positives > amounts.length / 2;
    }
  }
  return { format: 'Generic CSV', mapping, note: 'Check the preview: purchases should show as negative (red).' };
}

/**
 * Rocket Money writes spending as positive amounts and income as negative (the opposite of banks). Check
 * the file rather than assume: income-type rows decide, otherwise most rows being positive does.
 */
function rocketMoneyInverted(rows: string[][], m: CsvMapping): boolean {
  const amounts = rows.map((r) => ({ a: parseAmount(r[m.amount!]), cat: m.category != null ? (r[m.category] ?? '') : '' })).filter((x) => x.a != null && x.a !== 0);
  const income = amounts.filter((x) => /income|paycheck|salary|interest/i.test(x.cat));
  if (income.length) return income.filter((x) => x.a! < 0).length > income.length / 2;
  return amounts.filter((x) => x.a! > 0).length > amounts.length / 2;
}

export interface CsvReadResult {
  drafts: DraftTransaction[];
  /** Rows that were skipped because they had no valid date or amount (totals, disclaimers, etc). */
  skipped: number;
}

export function csvToDrafts(table: CsvTable, m: CsvMapping): CsvReadResult {
  const drafts: DraftTransaction[] = [];
  let skipped = 0;
  for (const r of dataRows(table)) {
    const date = parseBankDate(r[m.date]);
    let amount: number | null = null;
    if (m.amount != null) {
      amount = parseAmount(r[m.amount]);
      if (amount != null && m.type != null) {
        const t = (r[m.type] ?? '').trim().toLowerCase();
        if (/^(debit|dr|withdrawal)/.test(t)) amount = -Math.abs(amount);
        else if (/^(credit|cr|deposit)/.test(t)) amount = Math.abs(amount);
      }
    } else {
      const debit = m.debit != null ? parseAmount(r[m.debit]) : null;
      const credit = m.credit != null ? parseAmount(r[m.credit]) : null;
      if (debit != null || credit != null) amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date || amount == null) {
      skipped++;
      continue;
    }
    if (m.invert) amount = -amount;
    const description = (r[m.description] ?? '').replace(/\s+$/, '').trim() || '(no description)';
    const bankCategory = m.category != null ? r[m.category]?.trim() || undefined : undefined;
    const payeeHint = (m.payee ?? []).map((i) => (r[i] ?? '').trim()).find(Boolean);
    drafts.push({ date, amount, description, bankCategory, ...(payeeHint ? { payeeHint } : {}), ...(m.sourceAccount ? { sourceAccount: sourceAccountOf(r, m.sourceAccount) } : {}) });
  }
  return { drafts, skipped };
}

function sourceAccountOf(r: string[], c: NonNullable<CsvMapping['sourceAccount']>): SourceAccount {
  const cell = (i: number | null) => (i != null ? (r[i] ?? '').trim() : '');
  const institution = cell(c.institution);
  const name = cell(c.name) || 'Account';
  const last4 = cell(c.number).replace(/\D/g, '').slice(-4) || undefined;
  const type = cell(c.type) || undefined;
  return {
    key: `${institution}|${name}|${last4 ?? ''}`.toLowerCase(),
    label: [institution, `${name}${last4 ? ` ••${last4}` : ''}`].filter(Boolean).join(' · '),
    name,
    institution: institution || undefined,
    last4,
    type,
  };
}
