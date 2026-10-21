/**
 * IRAs (Roth and Traditional): yearly contribution limits, the deadline, and finding contributions.
 *
 * A contribution is a transaction in the IRA (money in) that carries the tax year it counts for. One
 * made from a bank file's line remembers it (`contributionFrom`): that line isn't offered again, and
 * undoing the import removes both. The IRS limit is per person, across all their IRAs together.
 */
import type { Account, AccountType, Category, Cents, ISODate, Transaction } from '../types';
import { diffDays } from './dates';

export const IRA_TYPES: AccountType[] = ['roth-ira', 'ira'];
export const isIra = (a: Pick<Account, 'type'>) => IRA_TYPES.includes(a.type);

/** What one person can put into all their IRAs for a tax year; 50 and older can add the catch-up. */
const LIMITS: Record<number, { base: Cents; catchUp: Cents }> = {
  2023: { base: 650_000, catchUp: 100_000 },
  2024: { base: 700_000, catchUp: 100_000 },
  2025: { base: 700_000, catchUp: 100_000 },
  2026: { base: 750_000, catchUp: 110_000 },
};
const LATEST = Math.max(...Object.keys(LIMITS).map(Number));

export interface IraLimit {
  limit: Cents;
  /** The 50-and-older catch-up is included. */
  catchUp: boolean;
  /** The IRS hasn't announced this year's limit yet; the latest known one is used. */
  estimated: boolean;
}

export function iraLimit(year: number, birthYear?: number): IraLimit {
  const known = Math.min(Math.max(year, 2023), LATEST);
  const l = LIMITS[known];
  // 50 or older by the end of the tax year.
  const catchUp = birthYear != null && year - birthYear >= 50;
  return { limit: l.base + (catchUp ? l.catchUp : 0), catchUp, estimated: year > LATEST };
}

/** The last day to contribute for a tax year: the following April 15. */
export const iraDeadline = (year: number): ISODate => `${year + 1}-04-15`;

/** The tax years a contribution made on `date` can count for: until April 15, last year's too. */
export function taxYearsFor(date: ISODate): number[] {
  const y = Number(date.slice(0, 4));
  return date <= iraDeadline(y - 1) ? [y - 1, y] : [y];
}

/** Total contributed for each tax year, across all IRAs. */
export function contributionsByYear(txns: Transaction[]): Map<number, Cents> {
  const out = new Map<number, Cents>();
  for (const t of txns) if (t.contributionYear != null) out.set(t.contributionYear, (out.get(t.contributionYear) ?? 0) + t.amount);
  return out;
}

export interface IraRoom extends IraLimit {
  year: number;
  contributed: Cents;
  /** Room left before the limit (0 once it's reached). */
  left: Cents;
  deadline: ISODate;
}

export function iraRoom(year: number, txns: Transaction[], birthYear?: number): IraRoom {
  const l = iraLimit(year, birthYear);
  const contributed = contributionsByYear(txns).get(year) ?? 0;
  return { ...l, year, contributed, left: Math.max(0, l.limit - contributed), deadline: iraDeadline(year) };
}

// ---------------------------------------------------------------------------------------------
// Spotting contributions in bank files
// ---------------------------------------------------------------------------------------------

/** Brokerages people usually keep IRAs at. */
const BROKERAGES =
  /\b(fidelity|vanguard|schwab|e\*?trade|merrill|robinhood|betterment|wealthfront|m1 finance|webull|tiaa|t\.? ?rowe|edward jones|ameriprise|interactive brokers|acorns|stash|sofi invest|ally invest|firstrade|public\.com)\b/i;
const IRA_WORDS = /\b(roth|ira)\b/i;
/** Bank lines in these categories are never contributions. */
const NEVER = new Set(['card-payment', 'owed']);
/** A name as a whole word, any case. */
const wordRe = (name: string) => new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i');

export interface SpottedContribution {
  /** The money leaving a bank account. */
  txn: Transaction;
  /** A contribution you already added by hand for the same amount, around the same day: confirming counts the line as that one. */
  match?: Transaction;
}

/**
 * Bank lines that look like money sent into an IRA: out of checking or savings, to a brokerage (or
 * mentioning an IRA or the name of the bank an IRA is at), in a tax year that's still open. Lines
 * already counted, or `reviewed` (a no, or a yes that matched one you typed), aren't offered again.
 */
export function spotContributions(args: {
  txns: Transaction[];
  accounts: Account[];
  categories: Map<string, Category>;
  reviewed: ReadonlySet<string>;
  today: ISODate;
}): SpottedContribution[] {
  const { txns, accounts, categories, reviewed, today } = args;
  const iras = accounts.filter((a) => isIra(a) && !a.archived);
  if (!iras.length) return [];
  const sources = new Set(accounts.filter((a) => a.type === 'checking' || a.type === 'savings').map((a) => a.id));
  const iraIds = new Set(iras.map((a) => a.id));
  const contributions = txns.filter((t) => iraIds.has(t.accountId) && t.contributionYear != null);
  const linked = new Set(contributions.map((t) => t.contributionFrom).filter((id): id is string => !!id));
  const banks = iras
    .map((a) => a.institution.trim())
    .filter((b) => b.length >= 3)
    .map(wordRe);
  const from = `${Math.min(...taxYearsFor(today))}-01-01`;
  const out: SpottedContribution[] = [];
  for (const t of txns) {
    if (t.amount >= 0 || !sources.has(t.accountId) || t.date < from || t.date > today || linked.has(t.id) || reviewed.has(t.id) || t.splits?.length) continue;
    const cat = categories.get(t.categoryId);
    if (cat?.group === 'income' || NEVER.has(t.categoryId)) continue;
    const text = `${t.payee} ${t.description}`;
    // The name of the bank an IRA is at is a weaker clue (you may bank there too), so it only counts for transfers.
    const toIraBank = (t.categoryId === 'uncategorized' || cat?.group === 'transfer') && banks.some((b) => b.test(text));
    if (!IRA_WORDS.test(text) && !BROKERAGES.test(text) && !toIraBank) continue;
    // A contribution typed in by hand for the same amount within a week is the same money.
    const match = contributions.find((c) => !c.contributionFrom && c.amount === -t.amount && Math.abs(diffDays(c.date, t.date)) <= 7);
    out.push({ txn: t, ...(match ? { match } : {}) });
  }
  return out;
}
