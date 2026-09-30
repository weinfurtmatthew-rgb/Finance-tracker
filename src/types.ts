/** Money is always stored as integer cents. Negative = money leaving the account. */
export type Cents = number;

/** Calendar date as 'YYYY-MM-DD' (no time zone surprises). */
export type ISODate = string;

/** 'wallet' is a payment app's balance: Venmo, Cash App, Apple Cash. */
export type AccountType = 'checking' | 'savings' | 'credit' | 'brokerage' | 'vehicle' | 'cash' | 'wallet' | 'loan' | 'other';

export type PaymentApp = 'venmo' | 'cashapp' | 'applecash';

/** Details from a payment app (Venmo, Cash App, Apple Cash). */
export interface TxnP2P {
  app: PaymentApp;
  /** The friend (or shop) on the other side. */
  person?: string;
  note?: string;
  kind?: 'payment' | 'transfer' | 'purchase' | 'reward' | 'other';
  /** Paid straight from a bank or card instead of the app balance. */
  fundedFrom?: string;
  /**
   * Waiting for the bank's line: the payment and the money in from the bank sit in the app account as
   * a pair sharing `ref`, and merge into the bank's line once that's imported.
   */
  role?: 'payment' | 'funding';
  ref?: string;
  /** On a bank line that the app's details were merged into: that app line's import id. */
  appImportId?: string;
}

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
  /** Credit cards & loans: yearly interest rate as a decimal (0.2299 = 22.99%). Used by the calculators. */
  apr?: number;
  /** Credit cards & loans: the minimum monthly payment. */
  minPayment?: Cents;
  /** Savings & checking: the yearly yield as a decimal (0.041 = 4.1%). */
  apy?: number;
  /** Last day the balance was confirmed to match the bank's. */
  checkedOn?: ISODate;
  /** When that confirmation was made (ms), to know which imports it already counted. */
  balanceSetAt?: number;
}

export interface Split {
  id: string;
  /** Signed like transactions; all parts add up to the transaction's amount. */
  amount: Cents;
  categoryId: string;
  note?: string;
  /** This part was for someone else: who owes it back. */
  owedBy?: string;
  /** When it was paid back: the repayment's transaction id, or 'untracked'. */
  settledBy?: string;
}

export type TransactionSource = 'manual' | 'csv' | 'ofx';

/**
 * Where a transaction's category came from. Your own choices teach the AI the most; guesses count
 * less, and AI picks you haven't reviewed yet ('ai') never teach it at all.
 */
export type CategorySource = 'user' | 'rule' | 'history' | 'bank' | 'keyword' | 'default' | 'ai';

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
  /** Missing on transactions from before this was tracked. */
  categorySource?: CategorySource;
  /**
   * Parts of this transaction, each with its own category (they add up to `amount`). A part paid for
   * someone else has `owedBy` and doesn't count as your spending.
   */
  splits?: Split[];
  /** Trips, events, anything: e.g. ["Italy 2026"]. */
  tags?: string[];
  /** The whole transaction was for someone else (category "Owed to Me"): who owes it. */
  owedBy?: string;
  /** When what's owed was paid back: the repayment's transaction id, or 'untracked' (cash etc.). */
  settledBy?: string;
  /** From a payment app, or a bank line merged with one. */
  p2p?: TxnP2P;
  notes: string;
  source: TransactionSource;
  /** Stable identifier used to skip duplicates when re-importing overlapping files. */
  importId?: string;
  /** Ids of the same transaction in other file formats (a CSV row that matched this QFX row). */
  altImportIds?: string[];
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
  /** Hidden from pickers (existing transactions keep it). */
  hidden?: boolean;
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
  /** A clean store name column (Rocket Money's "Custom Name", then "Name"). */
  payee?: number[];
  /** Columns naming the account each row is from, for files with several accounts (Rocket Money). */
  sourceAccount?: { institution: number | null; name: number | null; number: number | null; type: number | null };
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly';

export type RecurringKind = 'subscription' | 'bill' | 'loan' | 'income' | 'card-payment' | 'trial';

/** How to predict the next charge: average of the last 3, the last one, or a typed-in amount. */
export type AmountMode = 'average' | 'last' | 'manual';

export interface Recurring {
  id: string;
  name: string;
  kind: RecurringKind;
  frequency: Frequency;
  /** Case-insensitive text that identifies this charge in a transaction's description or payee. */
  match: string;
  /** When set, only charges within about ±20% of this amount match (used to split Apple bills). */
  matchAmount?: Cents;
  /** Typical amount, signed like transactions (negative = money out). Used for the 'manual' mode. */
  amount: Cents;
  /** Overrides the default prediction mode from Settings. */
  amountMode?: AmountMode;
  /** Due day of month for monthly / quarterly / yearly schedules. */
  dayOfMonth?: number;
  /** The two due days for twice-a-month schedules, e.g. [1, 15]. */
  days?: [number, number];
  /** Last known payment date; matched transactions later than this take over automatically. */
  lastPaidOn?: ISODate;
  /** Account it's usually paid from (informational). */
  accountId?: string;
  categoryId?: string;
  status: 'active' | 'cancelled';
  cancelledOn?: ISODate;
  cancelUrl?: string;
  /** For free trials: the day it turns into a paid subscription. */
  trialEndsOn?: ISODate;
  notes?: string;
  createdAt: number;
}

/** A monthly spending limit for one category. Each month starts fresh (no rollover). */
export interface Budget {
  categoryId: string;
  limit: Cents;
  createdAt: number;
}

/** A value you entered for an investment account or vehicle on a given day. */
export interface Valuation {
  id: string;
  accountId: string;
  date: ISODate;
  value: Cents;
}

/** Save up to `target` in a linked account, optionally by a date. */
export interface Goal {
  id: string;
  name: string;
  emoji: string;
  target: Cents;
  targetDate?: ISODate;
  accountId: string;
  createdAt: number;
}
