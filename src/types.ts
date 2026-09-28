/** Money is always stored as integer cents. Negative = money leaving the account. */
export type Cents = number;

/** Calendar date as 'YYYY-MM-DD' (no time zone surprises). */
export type ISODate = string;

export type AccountType = 'checking' | 'savings' | 'credit' | 'brokerage' | 'cash' | 'loan' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string;
  /** Last 4 digits of the account number, used to match OFX files to accounts. */
  last4?: string;
  /** Balance before the first transaction; account balance = openingBalance + sum(transactions). */
  openingBalance: Cents;
  archived: boolean;
  createdAt: number;
}

export type TransactionSource = 'manual' | 'csv' | 'ofx';

export interface Transaction {
  id: string;
  accountId: string;
  date: ISODate;
  amount: Cents;
  /** Raw description as provided by the bank (or typed in). */
  description: string;
  /** Cleaned-up merchant name shown in the UI. */
  payee: string;
  categoryId: string;
  notes: string;
  source: TransactionSource;
  /** Stable identifier used to skip duplicates when re-importing overlapping files. */
  importId?: string;
  createdAt: number;
}

export type CategoryGroup = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  group: CategoryGroup;
  order: number;
}

export interface Rule {
  id: string;
  /** Case-insensitive text that must appear in the transaction description or payee. */
  match: string;
  /** Optional replacement payee name. */
  payee?: string;
  /** Optional category to assign. */
  categoryId?: string;
  createdAt: number;
}

/** Remembered CSV column layout, keyed by the file's header signature. */
export interface CsvMapping {
  signature: string;
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  category: number | null;
  /** Column whose value says "debit"/"credit" when amounts are unsigned. */
  type: number | null;
  /** Multiply amounts by -1 (for exports where purchases are positive). */
  invert: boolean;
  /** Account this layout was last imported into. */
  accountId?: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
